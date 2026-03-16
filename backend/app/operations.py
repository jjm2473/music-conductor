from __future__ import annotations

import re
from pathlib import Path
from typing import Callable
from uuid import uuid4

from .config import AppConfig
from .library import (
    apply_special_char_map,
    detect_audio_format,
    find_lrc_for_music,
    list_music_entries,
    parse_two_part_name,
    read_easy_metadata,
    resolve_directory,
    write_easy_metadata,
)
from .models import (
    MetadataChangeItem,
    OperationExecuteResponse,
    OperationPlanItem,
    OperationPreviewRequest,
    OperationPreviewResponse,
    ScanErrorItem,
)


def _selected_entries(
    directory: Path,
    extensions: set[str],
    selected_files: list[str] | None,
) -> list[Path]:
    entries = list_music_entries(directory, extensions)
    if not selected_files:
        return entries

    selected_set = set(selected_files)
    return [entry for entry in entries if entry.name in selected_set]


def _reindex(items: list[OperationPlanItem]) -> list[OperationPlanItem]:
    indexed: list[OperationPlanItem] = []
    for idx, item in enumerate(items, start=1):
        indexed.append(item.model_copy(update={"id": f"item-{idx:04d}"}))
    return indexed


def _annotate_conflicts(items: list[OperationPlanItem], directory: Path) -> list[OperationPlanItem]:
    existing_names = {
        item.name
        for item in directory.iterdir()
        if item.exists() and item.is_file() and not item.is_symlink()
    }

    rename_items = [
        item
        for item in items
        if item.action == "rename" and item.source_file and item.destination_file
    ]

    source_names = {item.source_file for item in rename_items if item.source_file}

    destination_map: dict[str, list[OperationPlanItem]] = {}
    for item in rename_items:
        destination_map.setdefault(item.destination_file or "", []).append(item)

    annotated: list[OperationPlanItem] = []
    for item in items:
        updated = item
        if item.action != "rename" or not item.source_file or not item.destination_file:
            annotated.append(updated)
            continue

        if item.destination_file == item.source_file:
            annotated.append(updated)
            continue

        reasons: list[str] = []

        if item.destination_file in existing_names and item.destination_file not in source_names:
            reasons.append("目标文件已存在")

        same_dest_items = destination_map.get(item.destination_file, [])
        if len(same_dest_items) > 1:
            reasons.append("多个源文件映射到同一目标文件")

        if reasons:
            updated = item.model_copy(
                update={
                    "conflict": True,
                    "conflict_reason": "；".join(reasons),
                }
            )

        annotated.append(updated)

    return annotated


def _build_swap_preview(entries: list[Path], delimiter: str) -> list[OperationPlanItem]:
    items: list[OperationPlanItem] = []

    for entry in entries:
        parsed = parse_two_part_name(entry.stem, delimiter)
        if not parsed:
            continue

        first, second = parsed
        swapped_stem = f"{second}{delimiter}{first}"
        if swapped_stem == entry.stem:
            continue

        target_name = f"{swapped_stem}{entry.suffix}"
        items.append(
            OperationPlanItem(
                id="",
                action="rename",
                target_type="music",
                source_file=entry.name,
                destination_file=target_name,
                reason="A-B 与 B-A 互换",
            )
        )

        lrc = find_lrc_for_music(entry)
        if lrc:
            items.append(
                OperationPlanItem(
                    id="",
                    action="rename",
                    target_type="lrc",
                    source_file=lrc.name,
                    destination_file=f"{swapped_stem}.lrc",
                    reason="音乐文件重命名联动 lrc",
                )
            )

    return items


def _build_special_char_preview(entries: list[Path], char_map: dict[str, str]) -> list[OperationPlanItem]:
    if not char_map:
        return []

    items: list[OperationPlanItem] = []
    for entry in entries:
        replaced_stem = apply_special_char_map(entry.stem, char_map)
        if replaced_stem == entry.stem:
            continue

        target_name = f"{replaced_stem}{entry.suffix}"
        items.append(
            OperationPlanItem(
                id="",
                action="rename",
                target_type="music",
                source_file=entry.name,
                destination_file=target_name,
                reason="特殊字符映射替换",
            )
        )

        lrc = find_lrc_for_music(entry)
        if lrc:
            items.append(
                OperationPlanItem(
                    id="",
                    action="rename",
                    target_type="lrc",
                    source_file=lrc.name,
                    destination_file=f"{replaced_stem}.lrc",
                    reason="音乐文件重命名联动 lrc",
                )
            )

    return items


def _build_fix_extension_preview(
    entries: list[Path],
) -> tuple[list[OperationPlanItem], list[ScanErrorItem]]:
    items: list[OperationPlanItem] = []
    warnings: list[ScanErrorItem] = []

    for entry in entries:
        detected_format, preferred_extension, detect_error = detect_audio_format(entry)
        if detect_error:
            warnings.append(
                ScanErrorItem(
                    file_name=entry.name,
                    reason=f"无法识别音频格式，已跳过: {detect_error}",
                )
            )
            continue

        if not preferred_extension:
            warnings.append(
                ScanErrorItem(
                    file_name=entry.name,
                    reason="无法确定目标扩展名，已跳过",
                )
            )
            continue

        current_extension = entry.suffix.lower().lstrip(".")
        if current_extension == preferred_extension:
            continue

        destination_file = f"{entry.stem}.{preferred_extension}"
        if destination_file == entry.name:
            continue

        items.append(
            OperationPlanItem(
                id="",
                action="rename",
                target_type="music",
                source_file=entry.name,
                destination_file=destination_file,
                reason=f"根据检测格式({detected_format})修复扩展名",
            )
        )

    return items, warnings


def _build_metadata_fill_preview(
    entries: list[Path],
    delimiter: str,
    mode: str,
) -> list[OperationPlanItem]:
    items: list[OperationPlanItem] = []

    for entry in entries:
        parsed = parse_two_part_name(entry.stem, delimiter)
        if not parsed:
            continue

        first, second = parsed
        if mode == "artist_title":
            target_artist, target_title = first, second
        else:
            target_title, target_artist = first, second

        current, _ = read_easy_metadata(entry)
        changes: list[MetadataChangeItem] = []

        if current.get("artist", "") != target_artist:
            changes.append(
                MetadataChangeItem(
                    field="artist",
                    old_value=current.get("artist") or None,
                    new_value=target_artist,
                )
            )

        if current.get("title", "") != target_title:
            changes.append(
                MetadataChangeItem(
                    field="title",
                    old_value=current.get("title") or None,
                    new_value=target_title,
                )
            )

        if not changes:
            continue

        items.append(
            OperationPlanItem(
                id="",
                action="metadata_update",
                target_type="music",
                source_file=entry.name,
                metadata_changes=changes,
                reason="根据文件名填充元数据",
            )
        )

    return items


def _build_metadata_rename_preview(
    entries: list[Path],
    delimiter: str,
    mode: str,
) -> tuple[list[OperationPlanItem], list[ScanErrorItem]]:
    items: list[OperationPlanItem] = []
    warnings: list[ScanErrorItem] = []

    for entry in entries:
        current, metadata_error = read_easy_metadata(entry)
        if metadata_error:
            warnings.append(
                ScanErrorItem(
                    file_name=entry.name,
                    reason=f"读取元数据失败: {metadata_error}",
                )
            )
            continue

        artist = (current.get("artist") or "").strip()
        title = (current.get("title") or "").strip()

        missing_fields: list[str] = []
        if not artist:
            missing_fields.append("artist(艺术家)")
        if not title:
            missing_fields.append("title(歌曲名)")

        if missing_fields:
            warnings.append(
                ScanErrorItem(
                    file_name=entry.name,
                    reason=f"缺少必要元数据: {', '.join(missing_fields)}",
                )
            )
            continue

        if mode == "artist_title":
            renamed_stem = f"{artist}{delimiter}{title}"
        else:
            renamed_stem = f"{title}{delimiter}{artist}"

        target_name = f"{renamed_stem}{entry.suffix}"
        if target_name == entry.name:
            continue

        items.append(
            OperationPlanItem(
                id="",
                action="rename",
                target_type="music",
                source_file=entry.name,
                destination_file=target_name,
                reason="根据元数据重命名文件",
            )
        )

        lrc = find_lrc_for_music(entry)
        if lrc:
            items.append(
                OperationPlanItem(
                    id="",
                    action="rename",
                    target_type="lrc",
                    source_file=lrc.name,
                    destination_file=f"{renamed_stem}.lrc",
                    reason="音乐文件重命名联动 lrc",
                )
            )

    return items, warnings


def _build_metadata_text_cleanup_preview(
    entries: list[Path],
    pattern: str,
    use_regex: bool,
    case_sensitive: bool,
    cleanup_fields: list[str],
) -> list[OperationPlanItem]:
    items: list[OperationPlanItem] = []

    regex = re.compile(pattern, 0 if case_sensitive else re.IGNORECASE) if use_regex else None

    for entry in entries:
        current, _ = read_easy_metadata(entry)
        changes: list[MetadataChangeItem] = []

        for field in cleanup_fields:
            old_value = current.get(field, "")
            if regex:
                new_value = regex.sub("", old_value)
            elif case_sensitive:
                new_value = old_value.replace(pattern, "")
            else:
                new_value = re.sub(re.escape(pattern), "", old_value, flags=re.IGNORECASE)

            new_value = new_value.strip()

            if new_value != old_value:
                changes.append(
                    MetadataChangeItem(
                        field=field,
                        old_value=old_value or None,
                        new_value=new_value or None,
                    )
                )

        if not changes:
            continue

        items.append(
            OperationPlanItem(
                id="",
                action="metadata_update",
                target_type="music",
                source_file=entry.name,
                metadata_changes=changes,
                reason="批量清理元数据文本",
            )
        )

    return items


def _build_metadata_remove_fields_preview(
    entries: list[Path],
    remove_fields: set[str],
) -> list[OperationPlanItem]:
    items: list[OperationPlanItem] = []

    for entry in entries:
        current, _ = read_easy_metadata(entry)
        changes: list[MetadataChangeItem] = []

        for field in remove_fields:
            old_value = current.get(field, "")
            if not old_value:
                continue

            changes.append(
                MetadataChangeItem(
                    field=field,
                    old_value=old_value,
                    new_value=None,
                )
            )

        if not changes:
            continue

        items.append(
            OperationPlanItem(
                id="",
                action="metadata_update",
                target_type="music",
                source_file=entry.name,
                metadata_changes=changes,
                reason="批量删除元数据字段",
            )
        )

    return items


def _merge_metadata_items(groups: list[list[OperationPlanItem]]) -> list[OperationPlanItem]:
    merged: dict[str, OperationPlanItem] = {}

    for items in groups:
        for item in items:
            source = item.source_file
            if not source:
                continue

            existing = merged.get(source)
            if existing is None:
                merged[source] = item
                continue

            indexed_changes = {change.field: change for change in existing.metadata_changes}
            for change in item.metadata_changes:
                indexed_changes[change.field] = change

            merged[source] = existing.model_copy(
                update={
                    "metadata_changes": list(indexed_changes.values()),
                }
            )

    return list(merged.values())


def build_operation_preview(payload: OperationPreviewRequest, config: AppConfig) -> OperationPreviewResponse:
    directory_value = payload.directory or config.default_music_dir
    directory = resolve_directory(directory_value)

    entries = _selected_entries(directory, set(config.music_extensions), payload.selected_files)

    warnings: list[ScanErrorItem] = []

    if payload.operation == "swap_name_parts":
        items = _build_swap_preview(entries, config.filename_delimiter)
    elif payload.operation == "special_char_replace":
        char_map = payload.special_char_map if payload.special_char_map is not None else config.special_char_map
        items = _build_special_char_preview(entries, char_map)
    elif payload.operation == "fix_extension_by_format":
        items, warnings = _build_fix_extension_preview(entries)
    elif payload.operation == "metadata_fill_from_filename":
        fill_mode = payload.fill_mode or "artist_title"
        items = _build_metadata_fill_preview(entries, config.filename_delimiter, fill_mode)
    elif payload.operation == "rename_from_metadata":
        fill_mode = payload.fill_mode or "artist_title"
        items, warnings = _build_metadata_rename_preview(entries, config.filename_delimiter, fill_mode)
    elif payload.operation == "metadata_cleanup_text":
        cleanup_pattern = (payload.cleanup_pattern or "").strip()
        if not cleanup_pattern:
            raise ValueError("清理文本不能为空")
        cleanup_fields = payload.cleanup_fields or ["title", "artist", "album"]
        if not cleanup_fields:
            raise ValueError("清理字段不能为空")
        items = _build_metadata_text_cleanup_preview(
            entries,
            cleanup_pattern,
            payload.cleanup_use_regex,
            payload.cleanup_case_sensitive,
            cleanup_fields,
        )
    elif payload.operation == "metadata_cleanup_remove_fields":
        remove_fields = {field for field in (payload.remove_fields or []) if field}
        if not remove_fields:
            raise ValueError("请至少提供一个待删除字段")
        items = _build_metadata_remove_fields_preview(entries, remove_fields)
    else:
        # Backward compatible path for legacy metadata_cleanup.
        cleanup_fields = payload.cleanup_fields or ["title", "artist", "album"]
        remove_fields = {field for field in (payload.remove_fields or []) if field}
        text_items: list[OperationPlanItem] = []
        if payload.cleanup_pattern:
            text_targets = [field for field in cleanup_fields if field not in remove_fields]
            if text_targets:
                text_items = _build_metadata_text_cleanup_preview(
                    entries,
                    payload.cleanup_pattern,
                    payload.cleanup_use_regex,
                    payload.cleanup_case_sensitive,
                    text_targets,
                )
        remove_items = _build_metadata_remove_fields_preview(entries, remove_fields) if remove_fields else []
        items = _merge_metadata_items([text_items, remove_items])

    items = _annotate_conflicts(items, directory)
    items = _reindex(items)

    conflict_count = sum(1 for item in items if item.conflict)

    return OperationPreviewResponse(
        operation=payload.operation,
        directory=str(directory.resolve()),
        items=items,
        warnings=warnings,
        has_conflict=conflict_count > 0,
        conflict_count=conflict_count,
    )


def _execute_rename_items(
    directory: Path,
    items: list[OperationPlanItem],
    on_done: Callable[[str], None] | None = None,
    on_failure: Callable[[ScanErrorItem], None] | None = None,
) -> tuple[list[OperationPlanItem], list[ScanErrorItem]]:
    executed: list[OperationPlanItem] = []
    failed: list[ScanErrorItem] = []

    rename_items = [
        item
        for item in items
        if item.source_file
        and item.destination_file
        and item.source_file != item.destination_file
    ]

    staged: list[tuple[OperationPlanItem, Path, Path]] = []

    for item in rename_items:
        source_path = directory / item.source_file
        if not source_path.exists():
            failure = ScanErrorItem(file_name=item.source_file, reason="源文件不存在，无法重命名")
            failed.append(failure)
            if on_failure:
                on_failure(failure)
            if on_done:
                on_done(f"重命名失败: {item.source_file}")
            continue

        temp_path = directory / f".{item.source_file}.mc_tmp_{uuid4().hex}"

        try:
            source_path.rename(temp_path)
            staged.append((item, temp_path, directory / item.destination_file))
        except Exception as exc:
            failure = ScanErrorItem(file_name=item.source_file, reason=f"重命名暂存失败: {exc}")
            failed.append(failure)
            if on_failure:
                on_failure(failure)
            if on_done:
                on_done(f"重命名失败: {item.source_file}")

    for item, temp_path, destination_path in staged:
        try:
            temp_path.rename(destination_path)
            executed.append(item)
            if on_done:
                on_done(f"重命名完成: {item.source_file} -> {item.destination_file}")
        except Exception as exc:
            failure = ScanErrorItem(
                file_name=item.source_file or "",
                reason=f"重命名提交失败: {exc}",
            )
            failed.append(failure)
            if on_failure:
                on_failure(failure)
            if on_done:
                on_done(f"重命名失败: {item.source_file}")

    return executed, failed


def _execute_metadata_items(
    directory: Path,
    items: list[OperationPlanItem],
    on_done: Callable[[str], None] | None = None,
    on_failure: Callable[[ScanErrorItem], None] | None = None,
) -> tuple[list[OperationPlanItem], list[ScanErrorItem]]:
    executed: list[OperationPlanItem] = []
    failed: list[ScanErrorItem] = []

    for item in items:
        if not item.source_file:
            continue

        target = directory / item.source_file
        if not target.exists():
            failure = ScanErrorItem(file_name=item.source_file, reason="文件不存在")
            failed.append(failure)
            if on_failure:
                on_failure(failure)
            if on_done:
                on_done(f"写入失败: {item.source_file}")
            continue

        updates: dict[str, str] = {}
        remove_fields: list[str] = []

        for change in item.metadata_changes:
            if change.new_value is None:
                remove_fields.append(change.field)
            else:
                updates[change.field] = change.new_value

        try:
            write_easy_metadata(target, updates, remove_fields)
            executed.append(item)
            if on_done:
                on_done(f"写入元数据完成: {item.source_file}")
        except Exception as exc:
            failure = ScanErrorItem(file_name=item.source_file, reason=f"写入元数据失败: {exc}")
            failed.append(failure)
            if on_failure:
                on_failure(failure)
            if on_done:
                on_done(f"写入失败: {item.source_file}")

    return executed, failed


def execute_operation(
    payload: OperationPreviewRequest,
    config: AppConfig,
    progress_callback: Callable[[int, int, str], None] | None = None,
    failure_callback: Callable[[ScanErrorItem], None] | None = None,
) -> OperationExecuteResponse:
    preview = build_operation_preview(payload, config)

    if preview.has_conflict:
        conflict_failures = [
            ScanErrorItem(
                file_name=item.source_file or item.destination_file or "",
                reason=item.conflict_reason or "存在冲突，已阻止执行",
            )
            for item in preview.items
            if item.conflict
        ]
        if failure_callback:
            for failure in conflict_failures:
                failure_callback(failure)
        return OperationExecuteResponse(
            operation=preview.operation,
            directory=preview.directory,
            has_conflict=True,
            executed=[],
            failed=conflict_failures,
        )

    directory = resolve_directory(preview.directory)

    rename_items = [item for item in preview.items if item.action == "rename"]
    metadata_items = [item for item in preview.items if item.action == "metadata_update"]

    total_steps = max(1, len(rename_items) + len(metadata_items))
    done_steps = 0

    def on_done(subtask: str) -> None:
        nonlocal done_steps
        done_steps += 1
        if progress_callback:
            progress_callback(done_steps, total_steps, subtask)

    if not rename_items and not metadata_items and progress_callback:
        progress_callback(1, 1, "无可执行项")

    executed_rename, failed_rename = _execute_rename_items(
        directory,
        rename_items,
        on_done=on_done,
        on_failure=failure_callback,
    )
    executed_metadata, failed_metadata = _execute_metadata_items(
        directory,
        metadata_items,
        on_done=on_done,
        on_failure=failure_callback,
    )

    return OperationExecuteResponse(
        operation=preview.operation,
        directory=preview.directory,
        has_conflict=False,
        executed=[*executed_rename, *executed_metadata],
        failed=[*failed_rename, *failed_metadata],
    )
