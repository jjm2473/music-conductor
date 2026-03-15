from __future__ import annotations

from .config import AppConfig
from .library import (
    read_duration_seconds,
    read_full_metadata,
    resolve_directory,
    resolve_file_in_directory,
    write_easy_metadata,
)
from .models import (
    MetadataReadRequest,
    MetadataReadResponse,
    MetadataUpdateRequest,
    MetadataUpdateResponse,
    ScanErrorItem,
)


def read_metadata(payload: MetadataReadRequest, config: AppConfig) -> MetadataReadResponse:
    directory = resolve_directory(payload.directory or config.default_music_dir)
    target = resolve_file_in_directory(directory, payload.file_name, set(config.music_extensions))

    full_metadata, metadata_error = read_full_metadata(target)
    duration_seconds = read_duration_seconds(target)

    return MetadataReadResponse(
        directory=str(directory.resolve()),
        file_name=target.name,
        full_metadata=full_metadata,
        duration_seconds=duration_seconds,
        metadata_error=metadata_error,
    )


def update_metadata(payload: MetadataUpdateRequest, config: AppConfig) -> MetadataUpdateResponse:
    directory = resolve_directory(payload.directory or config.default_music_dir)
    target = resolve_file_in_directory(directory, payload.file_name, set(config.music_extensions))

    failed: list[ScanErrorItem] = []

    try:
        write_easy_metadata(target, payload.updates, payload.remove_fields)
    except Exception as exc:
        failed.append(
            ScanErrorItem(
                file_name=target.name,
                reason=f"写入元数据失败: {exc}",
            )
        )

    return MetadataUpdateResponse(
        directory=str(directory.resolve()),
        file_name=target.name,
        updated=len(failed) == 0,
        failed=failed,
    )
