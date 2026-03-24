from __future__ import annotations

from pathlib import Path
import re
import subprocess
from typing import Any, Iterable

from mutagen import File as MutagenFile


ROOT_EXCLUDED_DIRS = {
    "sys",
    "proc",
    "dev",
    "run",
    "tmp",
    "var",
    "cores",
    "private",
    "System",
    "Library",
    "Applications",
}


def _format_from_class_name(class_name: str) -> tuple[str | None, str | None]:
    mapped = {
        "MP3": ("MP3", "mp3"),
        "FLAC": ("FLAC", "flac"),
        "OggVorbis": ("OGG/Vorbis", "ogg"),
        "OggOpus": ("Opus", "opus"),
        "MP4": ("M4A/MP4", "m4a"),
        "AAC": ("AAC", "aac"),
        "ASF": ("WMA/ASF", "wma"),
        "MonkeysAudio": ("APE", "ape"),
        "WAVE": ("WAV", "wav"),
        "AIFF": ("AIFF", "aiff"),
    }
    return mapped.get(class_name, (None, None))


def _format_from_mime(mime_list: list[str]) -> tuple[str | None, str | None]:
    normalized = [item.lower() for item in mime_list]

    if any("audio/mpeg" in item for item in normalized):
        return "MP3", "mp3"
    if any("audio/flac" in item or "audio/x-flac" in item for item in normalized):
        return "FLAC", "flac"
    if any("audio/ogg" in item for item in normalized):
        return "OGG/Vorbis", "ogg"
    if any("audio/opus" in item for item in normalized):
        return "Opus", "opus"
    if any("audio/mp4" in item for item in normalized):
        return "M4A/MP4", "m4a"
    if any("audio/aac" in item for item in normalized):
        return "AAC", "aac"
    if any("audio/x-ms-wma" in item or "audio/asf" in item for item in normalized):
        return "WMA/ASF", "wma"
    if any("audio/x-ape" in item for item in normalized):
        return "APE", "ape"
    if any("audio/wav" in item or "audio/x-wav" in item for item in normalized):
        return "WAV", "wav"
    if any("audio/aiff" in item or "audio/x-aiff" in item for item in normalized):
        return "AIFF", "aiff"

    return None, None


def detect_audio_format(
    file_path: Path | None = None,
    audio: Any | None = None,
) -> tuple[str | None, str | None, str | None]:
    """Return (display_format, preferred_extension, error).

    If `audio` is provided, reuse it directly to avoid parsing the file twice.
    If only `file_path` is provided, try `easy=False` first and fall back to
    `easy=True` for extension-mismatch edge cases.
    """

    target_audio = audio

    if target_audio is None:
        if file_path is None:
            return None, None, "No file path provided for audio format detection"

        primary_error: str | None = None
        try:
            target_audio = MutagenFile(file_path, easy=False)
        except Exception as exc:  # pragma: no cover - third-party parser behavior
            primary_error = str(exc)

        # Some files with mismatched extension can fail in easy=False path while
        # still being parseable by mutagen in easy mode (for example FLAC data
        # stored under .mp3 suffix).
        if target_audio is None:
            fallback_error: str | None = None
            try:
                target_audio = MutagenFile(file_path, easy=True)
            except Exception as exc:  # pragma: no cover - third-party parser behavior
                fallback_error = str(exc)

            if target_audio is None:
                if primary_error and fallback_error:
                    return None, None, f"{primary_error}; fallback easy=True failed: {fallback_error}"
                if primary_error:
                    return None, None, primary_error
                if fallback_error:
                    return None, None, fallback_error
                return None, None, "Unsupported or unreadable audio format"

    if target_audio is None:
        return None, None, "Unsupported or unreadable audio format"

    class_name = target_audio.__class__.__name__
    display, preferred_extension = _format_from_class_name(class_name)
    if display and preferred_extension:
        return display, preferred_extension, None

    # easy=True can return classes like EasyMP3 / EasyMP4.
    if class_name.startswith("Easy"):
        display, preferred_extension = _format_from_class_name(class_name[len("Easy") :])
        if display and preferred_extension:
            return display, preferred_extension, None

    mime_list = [item for item in getattr(target_audio, "mime", []) if isinstance(item, str)]
    display, preferred_extension = _format_from_mime(mime_list)
    if display and preferred_extension:
        return display, preferred_extension, None

    return None, None, f"Unknown mutagen type: {class_name}"


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


def _is_root_excluded_path(path: Path, excluded: set[str]) -> bool:
    parts = [item for item in path.as_posix().split("/") if item]
    if not parts:
        return False
    return parts[0] in excluded


def _list_mounted_directories(excluded: set[str] | None = None) -> list[Path]:
    excluded_roots = excluded if excluded is not None else ROOT_EXCLUDED_DIRS

    try:
        result = subprocess.run(
            ["mount"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return []

    if result.returncode != 0:
        return []

    mounted: dict[str, Path] = {}

    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue

        match = re.search(r" on (.+?) \(", line)
        if match is None:
            match = re.search(r" on (.+?) type ", line)
        if match is None:
            continue

        mount_point = match.group(1).strip()
        path = Path(mount_point)
        if not path.is_absolute():
            continue

        resolved = path.resolve(strict=False)
        if resolved == Path("/"):
            continue
        if _is_root_excluded_path(resolved, excluded_roots):
            continue
        mounted[resolved.as_posix()] = resolved

    return sorted(mounted.values(), key=lambda item: item.as_posix().lower())


def suggest_directories(
    user_input: str | None,
    *,
    limit: int = 50,
    root_excluded_dirs: set[str] | None = None,
) -> tuple[str, str, list[str], bool]:
    raw_input = (user_input or "").strip()
    safe_limit = max(1, min(limit, 200))
    excluded = root_excluded_dirs if root_excluded_dirs is not None else ROOT_EXCLUDED_DIRS

    if not raw_input:
        return raw_input, "", [], False

    if not raw_input.startswith("/"):
        raw_input = f"/{raw_input.lstrip('/')}"

    probe_path = Path(raw_input).expanduser()
    if not probe_path.is_absolute():
        probe_path = probe_path.resolve(strict=False)

    if raw_input.endswith("/"):
        base_dir = probe_path.resolve(strict=False)
        name_prefix = ""
    else:
        base_dir = probe_path.parent.resolve(strict=False)
        name_prefix = probe_path.name

    normalized_input_path = probe_path.resolve(strict=False)

    if not base_dir.exists() or not base_dir.is_dir():
        return raw_input, str(base_dir), [], False

    normalized_prefix = name_prefix.lower()
    candidates: list[str] = []
    candidate_seen: set[str] = set()

    try:
        entries = sorted(base_dir.iterdir(), key=lambda item: item.name.lower())
    except PermissionError:
        return raw_input, str(base_dir), [], False

    if base_dir == Path("/") and raw_input == "/":
        entries.extend(_list_mounted_directories())

    for entry in entries:
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            continue
        resolved_entry = entry.resolve(strict=False)
        if base_dir == Path("/") and resolved_entry == Path("/"):
            continue
        if base_dir == Path("/") and _is_root_excluded_path(resolved_entry, excluded):
            continue
        if not raw_input.endswith("/") and resolved_entry == normalized_input_path:
            continue

        if normalized_prefix and not entry.name.lower().startswith(normalized_prefix):
            continue

        candidate_path = resolved_entry.as_posix().rstrip("/") + "/"
        if candidate_path in candidate_seen:
            continue
        candidate_seen.add(candidate_path)
        candidates.append(candidate_path)
        if len(candidates) >= safe_limit:
            break

    truncated = len(candidates) >= safe_limit
    return raw_input, str(base_dir), candidates, truncated


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

    primary_error: str | None = None
    try:
        audio = MutagenFile(file_path, easy=False)
    except Exception as exc:  # pragma: no cover - third-party parser behavior
        audio = None
        primary_error = str(exc)

    if audio is None:
        fallback_error: str | None = None
        try:
            audio = MutagenFile(file_path, easy=True)
        except Exception as exc:  # pragma: no cover - third-party parser behavior
            fallback_error = str(exc)

        if audio is None:
            if primary_error and fallback_error:
                return payload, f"{primary_error}; fallback easy=True failed: {fallback_error}"
            if primary_error:
                return payload, primary_error
            if fallback_error:
                return payload, fallback_error
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
