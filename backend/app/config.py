from __future__ import annotations

import os
import tomllib
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

DEFAULT_MUSIC_EXTENSIONS = [
    "mp3",
    "flac",
    "ogg",
    "opus",
    "m4a",
    "mp4",
    "aac",
    "wma",
    "ape",
    "wav",
    "aiff",
]

DEFAULT_CONFIG_DIR = Path.home() / ".config" / "music-conductor"
DEFAULT_CONFIG_FILE = DEFAULT_CONFIG_DIR / "config.toml"


class AppConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8000
    default_music_dir: str | None = None
    security_enabled: bool = False
    music_extensions: list[str] = Field(default_factory=lambda: DEFAULT_MUSIC_EXTENSIONS.copy())
    filename_delimiter: str = " - "
    special_char_map: dict[str, str] = Field(default_factory=dict)


def _clean_none(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


def _normalize_extensions(values: list[str] | None) -> list[str]:
    if not values:
        return DEFAULT_MUSIC_EXTENSIONS.copy()

    normalized: list[str] = []
    for value in values:
        item = value.strip().lower().lstrip(".")
        if item and item not in normalized:
            normalized.append(item)

    return normalized or DEFAULT_MUSIC_EXTENSIONS.copy()


def _parse_bool(value: str | None) -> bool | None:
    if value is None:
        return None
    lowered = value.strip().lower()
    if lowered in {"1", "true", "yes", "y", "on"}:
        return True
    if lowered in {"0", "false", "no", "n", "off"}:
        return False
    return None


def _parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _load_config_file(config_path: Path) -> dict[str, Any]:
    if not config_path.exists() or not config_path.is_file():
        return {}

    with config_path.open("rb") as config_file:
        data = tomllib.load(config_file)

    server = data.get("server", {})
    scan = data.get("scan", {})
    security = data.get("security", {})
    filename = data.get("filename", {})

    return _clean_none(
        {
            "host": server.get("host"),
            "port": server.get("port"),
            "default_music_dir": scan.get("default_music_dir") or scan.get("defaultMusicDir"),
            "security_enabled": security.get("enabled"),
            "music_extensions": scan.get("music_extensions") or scan.get("musicExtensions"),
            "filename_delimiter": filename.get("delimiter"),
            "special_char_map": filename.get("special_char_map") or filename.get("specialCharMap"),
        }
    )


def _load_env_config() -> dict[str, Any]:
    extensions = os.getenv("MC_SCAN_EXTENSIONS")
    extension_list = [item.strip() for item in extensions.split(",")] if extensions else None

    return _clean_none(
        {
            "host": os.getenv("MC_SERVER_HOST"),
            "port": _parse_int(os.getenv("MC_SERVER_PORT")),
            "default_music_dir": os.getenv("MC_MUSIC_DIR"),
            "security_enabled": _parse_bool(os.getenv("MC_SECURITY_ENABLED")),
            "music_extensions": extension_list,
        }
    )


def load_app_config(cli_overrides: dict[str, Any] | None = None) -> AppConfig:
    overrides = cli_overrides or {}
    config_path_value = (
        overrides.get("config_file")
        or os.getenv("MC_CONFIG_FILE")
        or str(DEFAULT_CONFIG_FILE)
    )

    config_path = Path(config_path_value).expanduser()

    file_values = _load_config_file(config_path)
    env_values = _load_env_config()

    merged: dict[str, Any] = {}
    merged.update(file_values)
    merged.update(env_values)
    merged.update(_clean_none({k: v for k, v in overrides.items() if k != "config_file"}))

    merged["music_extensions"] = _normalize_extensions(merged.get("music_extensions"))

    return AppConfig(**merged)
