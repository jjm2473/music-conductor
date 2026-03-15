export type MetadataSummary = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
};

export type MusicFileRecord = {
  id: string;
  file_name: string;
  absolute_path: string;
  extension: string;
  size_bytes: number;
  modified_at: string;
  duration_seconds?: number | null;
  metadata: MetadataSummary;
};

export type ScanErrorItem = {
  file_name: string;
  reason: string;
};

export type ScanResponse = {
  directory: string;
  files: MusicFileRecord[];
  skipped: ScanErrorItem[];
  total_files: number;
};

export type MetadataReadResponse = {
  directory: string;
  file_name: string;
  full_metadata: Record<string, unknown>;
  duration_seconds?: number | null;
  metadata_error?: string | null;
};

export type MetadataUpdateResponse = {
  directory: string;
  file_name: string;
  updated: boolean;
  failed: ScanErrorItem[];
};

export type MetadataChangeItem = {
  field: string;
  old_value?: string | null;
  new_value?: string | null;
};

export type OperationPlanItem = {
  id: string;
  action: "rename" | "metadata_update" | "delete" | "ignore";
  target_type: "music" | "lrc" | "system";
  source_file?: string | null;
  destination_file?: string | null;
  metadata_changes: MetadataChangeItem[];
  reason?: string | null;
  conflict: boolean;
  conflict_reason?: string | null;
};

export type OperationPreviewResponse = {
  operation: string;
  directory: string;
  items: OperationPlanItem[];
  warnings?: ScanErrorItem[];
  has_conflict: boolean;
  conflict_count: number;
};

export type OperationExecuteResponse = {
  operation: string;
  directory: string;
  has_conflict: boolean;
  executed: OperationPlanItem[];
  failed: ScanErrorItem[];
};

export type DuplicateGroupFile = {
  file_name: string;
  extension: string;
  size_bytes: number;
  has_lrc: boolean;
  duration_seconds?: number | null;
};

export type DuplicateGroup = {
  group_key: string;
  files: DuplicateGroupFile[];
};

export type DuplicateScanResponse = {
  directory: string;
  groups: DuplicateGroup[];
  ignored_files: string[];
};

export type DuplicateExecuteResponse = {
  directory: string;
  deleted_files: string[];
  lrc_renamed: string[];
  lrc_deleted: string[];
  ignored_written: string[];
  failed: ScanErrorItem[];
};

export type OperationType =
  | "swap_name_parts"
  | "special_char_replace"
  | "metadata_fill_from_filename"
  | "rename_from_metadata"
  | "metadata_cleanup_text"
  | "metadata_cleanup_remove_fields";

export type SortKey =
  | "file_name"
  | "size_bytes"
  | "modified_at"
  | "duration_seconds"
  | "title"
  | "artist"
  | "album";

export type SortState = {
  key: SortKey;
  order: "asc" | "desc";
};

export type SpecialCharMapRow = {
  id: string;
  from: string;
  to: string;
};

export type DuplicateDecisionState = {
  mode: "ignore" | "keep";
  keep_file: string | null;
};

export type TaskCreateResponse = {
  task_id: string;
  task_type: string;
};

export type TaskState = "running" | "completed" | "failed";

export type TaskStatusResponse = {
  task_id: string;
  task_type: string;
  state: TaskState;
  progress_percent: number;
  current_subtask?: string | null;
  started_at: string;
  finished_at?: string | null;
  failed: ScanErrorItem[];
  result?: unknown;
};

export type ActiveTask = {
  title: string;
  taskId: string;
  taskType: string;
  state: TaskState;
  progressPercent: number;
  currentSubtask: string;
  failed: ScanErrorItem[];
};
