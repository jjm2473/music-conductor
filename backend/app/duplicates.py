from __future__ import annotations

from pathlib import Path
from typing import Callable

from .config import AppConfig
from .library import (
    find_lrc_for_music,
    list_music_entries,
    parse_two_part_name,
    read_duration_seconds,
    resolve_directory,
)
from .models import (
    DuplicateExecuteRequest,
    DuplicateExecuteResponse,
    DuplicateGroup,
    DuplicateGroupFile,
    DuplicateScanResponse,
    ScanErrorItem,
)


def _ignore_file_path(directory: Path) -> Path:
    return directory / ".mcignore"


def load_ignore_set(directory: Path) -> set[str]:
    path = _ignore_file_path(directory)
    if not path.exists():
        return set()

    names: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            value = line.strip()
            if value:
                names.add(value)
    return names


def append_ignore_names(directory: Path, names: set[str]) -> list[str]:
    if not names:
        return []

    path = _ignore_file_path(directory)
    existing = load_ignore_set(directory)

    to_add = sorted(name for name in names if name not in existing)
    if not to_add:
        return []

    with path.open("a", encoding="utf-8") as handle:
        for name in to_add:
            handle.write(f"{name}\n")

    return to_add


def _duplicate_key(stem: str, delimiter: str) -> str | None:
    parsed = parse_two_part_name(stem, delimiter)
    if not parsed:
        return None

    first, second = parsed
    normalized = sorted([" ".join(first.split()).casefold(), " ".join(second.split()).casefold()])
    return f"{normalized[0]}::{normalized[1]}"


def _scan_group_paths(
    directory: Path,
    extensions: set[str],
    delimiter: str,
    ignored: set[str],
) -> dict[str, list[Path]]:
    entries = list_music_entries(directory, extensions)

    group_map: dict[str, list[Path]] = {}
    for entry in entries:
        if entry.name in ignored:
            continue

        key = _duplicate_key(entry.stem, delimiter)
        if not key:
            continue

        group_map.setdefault(key, []).append(entry)

    return {
        key: sorted(paths, key=lambda item: item.name.lower())
        for key, paths in group_map.items()
        if len(paths) > 1
    }


def scan_duplicates(directory_value: str | None, config: AppConfig) -> DuplicateScanResponse:
    directory = resolve_directory(directory_value or config.default_music_dir)
    ignored = load_ignore_set(directory)

    groups = _scan_group_paths(
        directory,
        set(config.music_extensions),
        config.filename_delimiter,
        ignored,
    )

    response_groups: list[DuplicateGroup] = []
    for key in sorted(groups.keys()):
        files = [
            DuplicateGroupFile(
                file_name=entry.name,
                extension=entry.suffix.lower().lstrip("."),
                size_bytes=entry.stat().st_size,
                has_lrc=find_lrc_for_music(entry) is not None,
                duration_seconds=read_duration_seconds(entry),
            )
            for entry in groups[key]
        ]
        response_groups.append(DuplicateGroup(group_key=key, files=files))

    return DuplicateScanResponse(
        directory=str(directory.resolve()),
        groups=response_groups,
        ignored_files=sorted(ignored),
    )


def execute_duplicates(
    payload: DuplicateExecuteRequest,
    config: AppConfig,
    progress_callback: Callable[[int, int, str], None] | None = None,
    failure_callback: Callable[[ScanErrorItem], None] | None = None,
) -> DuplicateExecuteResponse:
    directory = resolve_directory(payload.directory)
    ignored = load_ignore_set(directory)

    group_paths = _scan_group_paths(
        directory,
        set(config.music_extensions),
        config.filename_delimiter,
        ignored,
    )

    deleted_files: list[str] = []
    lrc_renamed: list[str] = []
    lrc_deleted: list[str] = []
    failed: list[ScanErrorItem] = []
    ignored_to_write: set[str] = set()

    total_steps = max(1, len(payload.decisions))
    done_steps = 0

    def step(subtask: str) -> None:
        nonlocal done_steps
        done_steps += 1
        if progress_callback:
            progress_callback(done_steps, total_steps, subtask)

    for decision in payload.decisions:
        files = group_paths.get(decision.group_key)
        if not files:
            step(f"跳过不存在分组: {decision.group_key}")
            continue

        if decision.ignore_group:
            ignored_to_write.update(entry.name for entry in files)
            step(f"忽略重复组: {decision.group_key}")
            continue

        keep_set = set(decision.keep_files)
        if not keep_set:
            failure = ScanErrorItem(
                file_name=decision.group_key,
                reason="未选择保留文件且未勾选忽略，已跳过该组",
            )
            failed.append(failure)
            if failure_callback:
                failure_callback(failure)
            step(f"去重组失败: {decision.group_key}")
            continue

        keep_paths = [entry for entry in files if entry.name in keep_set]
        delete_paths = [entry for entry in files if entry.name not in keep_set]

        if not keep_paths:
            failure = ScanErrorItem(
                file_name=decision.group_key,
                reason="保留文件不在重复组内，已跳过该组",
            )
            failed.append(failure)
            if failure_callback:
                failure_callback(failure)
            step(f"去重组失败: {decision.group_key}")
            continue

        used_donor_lrc: set[Path] = set()
        donor_lrc_candidates = [
            delete_entry.with_suffix(".lrc")
            for delete_entry in delete_paths
            if delete_entry.with_suffix(".lrc").exists()
        ]

        for keep_entry in keep_paths:
            keep_lrc = keep_entry.with_suffix(".lrc")
            if keep_lrc.exists():
                continue

            donor = next(
                (
                    candidate
                    for candidate in donor_lrc_candidates
                    if candidate.exists() and candidate not in used_donor_lrc
                ),
                None,
            )

            if donor is None:
                continue

            try:
                donor.rename(keep_lrc)
                used_donor_lrc.add(donor)
                lrc_renamed.append(f"{donor.name} -> {keep_lrc.name}")
            except Exception as exc:
                failure = ScanErrorItem(file_name=donor.name, reason=f"lrc 迁移失败: {exc}")
                failed.append(failure)
                if failure_callback:
                    failure_callback(failure)

        for delete_entry in delete_paths:
            delete_lrc = delete_entry.with_suffix(".lrc")
            if delete_lrc in used_donor_lrc:
                continue
            if not delete_lrc.exists():
                continue

            try:
                delete_lrc.unlink()
                lrc_deleted.append(delete_lrc.name)
            except Exception as exc:
                failure = ScanErrorItem(file_name=delete_lrc.name, reason=f"删除 lrc 失败: {exc}")
                failed.append(failure)
                if failure_callback:
                    failure_callback(failure)

        for delete_entry in delete_paths:
            try:
                delete_entry.unlink()
                deleted_files.append(delete_entry.name)
            except Exception as exc:
                failure = ScanErrorItem(file_name=delete_entry.name, reason=f"删除音乐文件失败: {exc}")
                failed.append(failure)
                if failure_callback:
                    failure_callback(failure)

        step(f"处理重复组: {decision.group_key}")

    if not payload.decisions and progress_callback:
        progress_callback(1, 1, "无去重决策")

    ignored_written = append_ignore_names(directory, ignored_to_write)

    return DuplicateExecuteResponse(
        directory=str(directory.resolve()),
        deleted_files=deleted_files,
        lrc_renamed=lrc_renamed,
        lrc_deleted=lrc_deleted,
        ignored_written=ignored_written,
        failed=failed,
    )
