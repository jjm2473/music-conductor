from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class MetadataSummary(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None


class MusicFileRecord(BaseModel):
    id: str
    file_name: str
    absolute_path: str
    extension: str
    format: str
    size_bytes: int
    modified_at: datetime
    duration_seconds: float | None = None
    metadata: MetadataSummary = Field(default_factory=MetadataSummary)


class ScanErrorItem(BaseModel):
    file_name: str
    reason: str


class ScanRequest(BaseModel):
    directory: str | None = None


class DirectorySuggestResponse(BaseModel):
    input: str
    base_dir: str
    candidates: list[str]
    truncated: bool = False


class ScanResponse(BaseModel):
    directory: str
    files: list[MusicFileRecord]
    skipped: list[ScanErrorItem]
    total_files: int


class MetadataChangeItem(BaseModel):
    field: str
    old_value: str | None = None
    new_value: str | None = None


class OperationPlanItem(BaseModel):
    id: str
    action: Literal["rename", "metadata_update", "delete", "ignore"]
    target_type: Literal["music", "lrc", "system"]
    source_file: str | None = None
    destination_file: str | None = None
    metadata_changes: list[MetadataChangeItem] = Field(default_factory=list)
    reason: str | None = None
    conflict: bool = False
    conflict_reason: str | None = None


class OperationPreviewRequest(BaseModel):
    directory: str | None = None
    operation: Literal[
        "swap_name_parts",
        "special_char_replace",
        "fix_extension_by_format",
        "metadata_fill_from_filename",
        "rename_from_metadata",
        "metadata_cleanup_text",
        "metadata_cleanup_remove_fields",
        "metadata_cleanup",
    ]
    selected_files: list[str] | None = None
    special_char_map: dict[str, str] | None = None
    fill_mode: Literal["artist_title", "title_artist"] | None = None
    cleanup_pattern: str | None = None
    cleanup_use_regex: bool = False
    cleanup_case_sensitive: bool = False
    cleanup_fields: list[str] | None = None
    remove_fields: list[str] | None = None


class OperationPreviewResponse(BaseModel):
    operation: str
    directory: str
    items: list[OperationPlanItem]
    warnings: list[ScanErrorItem] = Field(default_factory=list)
    has_conflict: bool
    conflict_count: int


class OperationExecuteResponse(BaseModel):
    operation: str
    directory: str
    has_conflict: bool
    executed: list[OperationPlanItem]
    failed: list[ScanErrorItem]


class DuplicateGroupFile(BaseModel):
    file_name: str
    extension: str
    size_bytes: int
    has_lrc: bool
    duration_seconds: float | None = None


class DuplicateGroup(BaseModel):
    group_key: str
    files: list[DuplicateGroupFile]


class DuplicateScanRequest(BaseModel):
    directory: str | None = None


class DuplicateScanResponse(BaseModel):
    directory: str
    groups: list[DuplicateGroup]
    ignored_files: list[str]


class DuplicateDecision(BaseModel):
    group_key: str
    keep_files: list[str] = Field(default_factory=list)
    ignore_group: bool = True


class DuplicateExecuteRequest(BaseModel):
    directory: str
    decisions: list[DuplicateDecision]


class DuplicateExecuteResponse(BaseModel):
    directory: str
    deleted_files: list[str]
    lrc_renamed: list[str]
    lrc_deleted: list[str]
    ignored_written: list[str]
    failed: list[ScanErrorItem]


class MetadataReadRequest(BaseModel):
    directory: str | None = None
    file_name: str


class MetadataReadResponse(BaseModel):
    directory: str
    file_name: str
    full_metadata: dict[str, Any]
    duration_seconds: float | None = None
    metadata_error: str | None = None


class MetadataUpdateRequest(BaseModel):
    directory: str | None = None
    file_name: str
    updates: dict[str, str] = Field(default_factory=dict)
    remove_fields: list[str] = Field(default_factory=list)


class MetadataUpdateResponse(BaseModel):
    directory: str
    file_name: str
    updated: bool
    failed: list[ScanErrorItem]


TaskState = Literal["running", "completed", "failed"]


class TaskCreateResponse(BaseModel):
    task_id: str
    task_type: str


class TaskStatusResponse(BaseModel):
    task_id: str
    task_type: str
    state: TaskState
    progress_percent: float
    current_subtask: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
    failed: list[ScanErrorItem] = Field(default_factory=list)
    result: dict[str, Any] | None = None
