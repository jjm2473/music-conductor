from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from mutagen import File as MutagenFile

from .library import detect_audio_format
from .models import MetadataSummary, MusicFileRecord, ScanErrorItem


def _extract_metadata(file_path: Path) -> tuple[float | None, MetadataSummary, str | None, str]:
    metadata = MetadataSummary()

    try:
        audio = MutagenFile(file_path, easy=True)
    except Exception as exc:  # pragma: no cover - depends on third-party parser behavior
        detected_format, _, format_error = detect_audio_format(file_path=file_path)
        message = str(exc)
        if format_error:
            message = f"{message}; format detect failed: {format_error}"
        return None, metadata, message, detected_format or "UNKNOWN"

    if audio is None:
        detected_format, _, format_error = detect_audio_format(file_path=file_path)
    else:
        detected_format, _, format_error = detect_audio_format(file_path=file_path, audio=audio)

    display_format = detected_format or "UNKNOWN"

    if audio is None:
        message = "Unsupported or unreadable audio metadata"
        if format_error:
            message = f"{message}; format detect failed: {format_error}"
        return None, metadata, message, display_format

    duration_seconds: float | None = None
    if getattr(audio, "info", None) is not None and getattr(audio.info, "length", None) is not None:
        duration_seconds = round(float(audio.info.length), 2)

    tags = getattr(audio, "tags", {}) or {}

    def first_value(key: str) -> str | None:
        value = tags.get(key)
        if isinstance(value, list):
            return str(value[0]) if value else None
        if value is None:
            return None
        return str(value)

    metadata.title = first_value("title")
    metadata.artist = first_value("artist")
    metadata.album = first_value("album")

    return duration_seconds, metadata, None, display_format


def scan_music_directory(
    directory: Path,
    extensions: set[str],
    progress_callback: Callable[[int, int, str], None] | None = None,
    failure_callback: Callable[[ScanErrorItem], None] | None = None,
) -> tuple[list[MusicFileRecord], list[ScanErrorItem]]:
    records: list[MusicFileRecord] = []
    skipped: list[ScanErrorItem] = []

    entries = [
        entry
        for entry in sorted(directory.iterdir(), key=lambda item: item.name.lower())
        if not entry.name.startswith(".")
        and not entry.is_symlink()
        and not entry.is_dir()
        and entry.suffix.lower().lstrip(".") in extensions
    ]

    total = len(entries)

    for index, entry in enumerate(entries, start=1):
        suffix = entry.suffix.lower().lstrip(".")

        stat = entry.stat()
        duration_seconds, metadata, metadata_error, detected_format = _extract_metadata(entry)

        records.append(
            MusicFileRecord(
                id=entry.name,
                file_name=entry.name,
                absolute_path=str(entry.resolve()),
                extension=suffix,
                format=detected_format,
                size_bytes=stat.st_size,
                modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                duration_seconds=duration_seconds,
                metadata=metadata,
            )
        )

        if metadata_error:
            failure = ScanErrorItem(
                file_name=entry.name,
                reason=f"Metadata read failed: {metadata_error}",
            )
            skipped.append(failure)
            if failure_callback:
                failure_callback(failure)

        if progress_callback:
            progress_callback(index, total, f"扫描文件: {entry.name}")

    return records, skipped
