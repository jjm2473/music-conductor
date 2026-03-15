from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from mutagen import File as MutagenFile


def resolve_directory(directory_value: str | None) -> Path:
    if not directory_value:
        raise ValueError("No directory provided.")

    directory = Path(directory_value).expanduser()
    if not directory.exists() or not directory.is_dir():
        raise ValueError("Directory does not exist or is not a folder.")

    return directory


def resolve_file_in_directory(
    directory: Path,
    file_name: str,
    extensions: set[str] | None = None,
) -> Path:
    if not file_name or Path(file_name).name != file_name:
        raise ValueError("Invalid file name.")

    target = directory / file_name

    if not target.exists() or not target.is_file() or target.is_symlink():
        raise ValueError("Target file does not exist or is invalid.")

    if extensions is not None:
        suffix = target.suffix.lower().lstrip(".")
        if suffix not in extensions:
            raise ValueError("Target file extension is not allowed.")

    return target


def list_music_entries(directory: Path, extensions: set[str]) -> list[Path]:
    entries: list[Path] = []
    for entry in sorted(directory.iterdir(), key=lambda item: item.name.lower()):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or entry.is_dir():
            continue
        if entry.suffix.lower().lstrip(".") not in extensions:
            continue
        entries.append(entry)
    return entries


def find_lrc_for_music(music_path: Path) -> Path | None:
    candidate = music_path.with_suffix(".lrc")
    if candidate.exists() and candidate.is_file() and not candidate.is_symlink():
        return candidate
    return None


def parse_two_part_name(stem: str, delimiter: str) -> tuple[str, str] | None:
    parts = stem.split(delimiter)
    if len(parts) != 2:
        return None
    first, second = parts[0].strip(), parts[1].strip()
    if not first or not second:
        return None
    return first, second


def apply_special_char_map(value: str, mapping: dict[str, str]) -> str:
    updated = value
    for old, new in mapping.items():
        updated = updated.replace(old, new)
    return updated


def read_easy_metadata(file_path: Path) -> tuple[dict[str, str], str | None]:
    metadata: dict[str, str] = {}

    try:
        audio = MutagenFile(file_path, easy=True)
    except Exception as exc:  # pragma: no cover - third-party parser behavior
        return metadata, str(exc)

    if audio is None:
        return metadata, "Unsupported or unreadable audio metadata"

    tags = getattr(audio, "tags", {}) or {}

    for key in ["title", "artist", "album"]:
        value = tags.get(key)
        if isinstance(value, list):
            metadata[key] = str(value[0]) if value else ""
        elif value is None:
            metadata[key] = ""
        else:
            metadata[key] = str(value)

    return metadata, None


def read_full_metadata(file_path: Path) -> tuple[dict[str, Any], str | None]:
    payload: dict[str, Any] = {}

    try:
        audio = MutagenFile(file_path, easy=False)
    except Exception as exc:  # pragma: no cover - third-party parser behavior
        return payload, str(exc)

    if audio is None:
        return payload, "Unsupported or unreadable audio metadata"

    tags = getattr(audio, "tags", {}) or {}
    serialized_tags: dict[str, Any] = {}
    for key, value in tags.items():
        if isinstance(value, list):
            serialized_tags[str(key)] = [str(item) for item in value]
        else:
            serialized_tags[str(key)] = str(value)

    payload["tags"] = serialized_tags

    info = getattr(audio, "info", None)
    if info is not None:
        technical: dict[str, Any] = {}
        for attr in ["length", "bitrate", "sample_rate", "channels", "bits_per_sample"]:
            value = getattr(info, attr, None)
            if value is not None:
                technical[attr] = value
        if technical:
            payload["technical"] = technical

    return payload, None


def read_duration_seconds(file_path: Path) -> float | None:
    try:
        audio = MutagenFile(file_path, easy=True)
    except Exception:  # pragma: no cover - third-party parser behavior
        return None

    if audio is None:
        return None

    info = getattr(audio, "info", None)
    length = getattr(info, "length", None)
    if length is None:
        return None
    return round(float(length), 2)


def write_easy_metadata(
    file_path: Path,
    updates: dict[str, str],
    remove_fields: Iterable[str],
) -> None:
    audio = MutagenFile(file_path, easy=True)
    if audio is None:
        raise ValueError("Unsupported or unreadable audio metadata")

    if getattr(audio, "tags", None) is None:
        audio.add_tags()

    for field in remove_fields:
        if field in audio:
            del audio[field]

    for field, value in updates.items():
        audio[field] = [value]

    audio.save()
