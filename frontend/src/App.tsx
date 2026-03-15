import { useEffect, useMemo, useRef, useState } from "react";

type MetadataSummary = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
};

type MusicFileRecord = {
  id: string;
  file_name: string;
  absolute_path: string;
  extension: string;
  size_bytes: number;
  modified_at: string;
  duration_seconds?: number | null;
  metadata: MetadataSummary;
};

type ScanErrorItem = {
  file_name: string;
  reason: string;
};

type ScanResponse = {
  directory: string;
  files: MusicFileRecord[];
  skipped: ScanErrorItem[];
  total_files: number;
};

type MetadataReadResponse = {
  directory: string;
  file_name: string;
  full_metadata: Record<string, unknown>;
  duration_seconds?: number | null;
  metadata_error?: string | null;
};

type MetadataUpdateResponse = {
  directory: string;
  file_name: string;
  updated: boolean;
  failed: ScanErrorItem[];
};

type MetadataChangeItem = {
  field: string;
  old_value?: string | null;
  new_value?: string | null;
};

type OperationPlanItem = {
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

type OperationPreviewResponse = {
  operation: string;
  directory: string;
  items: OperationPlanItem[];
  warnings?: ScanErrorItem[];
  has_conflict: boolean;
  conflict_count: number;
};

type OperationExecuteResponse = {
  operation: string;
  directory: string;
  has_conflict: boolean;
  executed: OperationPlanItem[];
  failed: ScanErrorItem[];
};

type DuplicateGroupFile = {
  file_name: string;
  extension: string;
  size_bytes: number;
  has_lrc: boolean;
  duration_seconds?: number | null;
};

type DuplicateGroup = {
  group_key: string;
  files: DuplicateGroupFile[];
};

type DuplicateScanResponse = {
  directory: string;
  groups: DuplicateGroup[];
  ignored_files: string[];
};

type DuplicateExecuteResponse = {
  directory: string;
  deleted_files: string[];
  lrc_renamed: string[];
  lrc_deleted: string[];
  ignored_written: string[];
  failed: ScanErrorItem[];
};

type OperationType =
  | "swap_name_parts"
  | "special_char_replace"
  | "metadata_fill_from_filename"
  | "rename_from_metadata"
  | "metadata_cleanup";

type SortKey =
  | "file_name"
  | "size_bytes"
  | "modified_at"
  | "duration_seconds"
  | "title"
  | "artist"
  | "album";

type SortState = {
  key: SortKey;
  order: "asc" | "desc";
};

const getDefaultSortOrder = (key: SortKey): SortState["order"] => {
  if (key === "file_name" || key === "title" || key === "artist" || key === "album") {
    return "asc";
  }
  return "desc";
};

type SortHeaderButtonProps = {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
};

function SortHeaderButton({ label, sortKey, sort, onSort }: SortHeaderButtonProps) {
  const isActive = sort.key === sortKey;
  const indicator = sort.order === "asc" ? "+" : "-";

  return (
    <button
      type="button"
      className={`sort-button${isActive ? " is-active" : ""}`}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      <span
        className={`sort-indicator${isActive ? "" : " is-placeholder"}`}
        aria-hidden={!isActive}
      >
        {isActive ? indicator : "+"}
      </span>
    </button>
  );
}

type DuplicateDecisionState = {
  mode: "ignore" | "keep";
  keep_file: string | null;
};

type TaskCreateResponse = {
  task_id: string;
  task_type: string;
};

type TaskState = "running" | "completed" | "failed";

type TaskStatusResponse = {
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

type ActiveTask = {
  title: string;
  taskId: string;
  taskType: string;
  state: TaskState;
  progressPercent: number;
  currentSubtask: string;
  failed: ScanErrorItem[];
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

const formatBytes = (value: number): string => {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatDuration = (value?: number | null): string => {
  if (value == null) {
    return "-";
  }
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
};

const sleep = async (ms: number) => {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
};

const uniqueFailures = (items: ScanErrorItem[]): ScanErrorItem[] => {
  const seen = new Set<string>();
  const merged: ScanErrorItem[] = [];
  for (const item of items) {
    const key = `${item.file_name}::${item.reason}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
};

const firstTagValue = (value: unknown): string => {
  if (Array.isArray(value) && value.length > 0) {
    return String(value[0] ?? "");
  }
  if (value == null) {
    return "";
  }
  return String(value);
};

const parseErrorDetail = async (result: Response, fallback: string): Promise<string> => {
  const payload = (await result.json().catch(() => null)) as { detail?: string } | null;
  return payload?.detail ?? fallback;
};

const parseCsv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const TIME_FILTER_OPTIONS = [
  { value: 0, label: "全部", ms: Number.POSITIVE_INFINITY },
  { value: 1, label: "1小时", ms: 60 * 60 * 1000 },
  { value: 2, label: "6小时", ms: 6 * 60 * 60 * 1000 },
  { value: 3, label: "1天", ms: 24 * 60 * 60 * 1000 },
  { value: 4, label: "3天", ms: 3 * 24 * 60 * 60 * 1000 },
  { value: 5, label: "1周", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: 6, label: "1个月", ms: 30 * 24 * 60 * 60 * 1000 },
  { value: 7, label: "6个月", ms: 183 * 24 * 60 * 60 * 1000 },
  { value: 8, label: "1年", ms: 365 * 24 * 60 * 60 * 1000 },
  { value: 9, label: "2年", ms: 2 * 365 * 24 * 60 * 60 * 1000 },
  { value: 10, label: "5年", ms: 5 * 365 * 24 * 60 * 60 * 1000 },
  { value: 11, label: "10年", ms: 10 * 365 * 24 * 60 * 60 * 1000 },
  { value: 12, label: "20年", ms: 20 * 365 * 24 * 60 * 60 * 1000 },
] as const;

type TimeFilterValue = (typeof TIME_FILTER_OPTIONS)[number]["value"];

const getTimeFilterOption = (value: TimeFilterValue) =>
  TIME_FILTER_OPTIONS.find((item) => item.value === value) ?? TIME_FILTER_OPTIONS[0];

const normalizeFileName = (fileName: string) => fileName.toLowerCase().trim();

const buildMediaPreviewUrl = (directory: string, fileName: string): string => {
  const params = new URLSearchParams({
    directory,
    file_name: fileName,
  });
  return `${API_BASE}/api/media/preview?${params.toString()}`;
};

const ignoreMediaPreviewError = () => {
  // Some formats may not be decodable by current browser; ignore preview errors by requirement.
};

const formatPlayerTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
};

type InlineAudioPreviewProps = {
  playerId: string;
  sourceUrl: string;
};

function InlineAudioPreview({ playerId, sourceUrl }: InlineAudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loadingPlay, setLoadingPlay] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const onPlay = () => {
      setPlaying(true);
      setLoadingPlay(false);
    };
    const onPause = () => {
      setPlaying(false);
    };
    const onTimeUpdate = () => {
      setPositionSec(audio.currentTime || 0);
    };
    const onLoadedMetadata = () => {
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDurationSec(nextDuration);
    };
    const onEnded = () => {
      setPlaying(false);
    };
    const onError = () => {
      setLoadingPlay(false);
      setPlaying(false);
      ignoreMediaPreviewError();
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    if (!sourceLoaded || !loadingPlay) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    void audio.play().catch(() => {
      setLoadingPlay(false);
      ignoreMediaPreviewError();
    });
  }, [sourceLoaded, loadingPlay]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (playing) {
      audio.pause();
      return;
    }

    setLoadingPlay(true);

    if (!sourceLoaded) {
      setSourceLoaded(true);
      return;
    }

    void audio.play().catch(() => {
      setLoadingPlay(false);
      ignoreMediaPreviewError();
    });
  };

  const onSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextPosition = Number(event.target.value);
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextPosition)) {
      return;
    }

    audio.currentTime = nextPosition;
    setPositionSec(nextPosition);
  };

  const normalizedDuration = durationSec > 0 ? durationSec : 0;
  const normalizedPosition = Math.max(0, Math.min(positionSec, normalizedDuration));

  return (
    <div className="inline-audio-player" data-player-id={playerId}>
      <button type="button" className="inline-audio-toggle" onClick={togglePlay}>
        {playing ? "暂停" : loadingPlay ? "加载中" : "播放"}
      </button>

      <input
        className="inline-audio-seek"
        type="range"
        min={0}
        max={normalizedDuration}
        step={1}
        value={normalizedPosition}
        onChange={onSeek}
        disabled={normalizedDuration <= 0}
        aria-label="播放位置"
      />

      <span className="inline-audio-time">{formatPlayerTime(normalizedPosition)} / {formatPlayerTime(normalizedDuration)}</span>

      <audio
        ref={audioRef}
        preload="none"
        src={sourceLoaded ? sourceUrl : undefined}
      />
    </div>
  );
}

export default function App() {
  const [directory, setDirectory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilterValue>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ScanResponse | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "modified_at", order: "desc" });
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [focusedFile, setFocusedFile] = useState<string | null>(null);
  const [anchorFile, setAnchorFile] = useState<string | null>(null);
  const [dragSelecting, setDragSelecting] = useState(false);
  const [dragSelectionMode, setDragSelectionMode] = useState<"select" | "unselect">("select");
  const [dragAnchorIndex, setDragAnchorIndex] = useState<number | null>(null);

  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const [operationType, setOperationType] = useState<OperationType>("swap_name_parts");
  const [fillMode, setFillMode] = useState<"artist_title" | "title_artist">("artist_title");
  const [cleanupPattern, setCleanupPattern] = useState("");
  const [cleanupUseRegex, setCleanupUseRegex] = useState(false);
  const [cleanupFieldsInput, setCleanupFieldsInput] = useState("title,artist,album");
  const [removeFieldsInput, setRemoveFieldsInput] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationPreview, setOperationPreview] = useState<OperationPreviewResponse | null>(null);
  const [operationResult, setOperationResult] = useState<OperationExecuteResponse | null>(null);

  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicateData, setDuplicateData] = useState<DuplicateScanResponse | null>(null);
  const [duplicateDecisionMap, setDuplicateDecisionMap] = useState<Record<string, DuplicateDecisionState>>({});
  const [duplicateResult, setDuplicateResult] = useState<DuplicateExecuteResponse | null>(null);

  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);

  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataTargetFile, setMetadataTargetFile] = useState<string | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataNotice, setMetadataNotice] = useState<string | null>(null);
  const [metadataFull, setMetadataFull] = useState<Record<string, unknown> | null>(null);
  const [metadataForm, setMetadataForm] = useState({ title: "", artist: "", album: "" });
  const [metadataRemoveFieldsInput, setMetadataRemoveFieldsInput] = useState("");
  const [showGlobalScrollActions, setShowGlobalScrollActions] = useState(false);

  const sortedFiles = useMemo(() => {
    const files = response?.files ?? [];
    const normalizedKeyword = keyword.trim().toLowerCase();
    const thresholdOption = getTimeFilterOption(timeFilter);
    const threshold =
      thresholdOption.ms === Number.POSITIVE_INFINITY ? -Number.POSITIVE_INFINITY : Date.now() - thresholdOption.ms;
    const filtered = normalizedKeyword
      ? files.filter((file) => {
          const haystack = [
            file.file_name,
            file.metadata.title ?? "",
            file.metadata.artist ?? "",
            file.metadata.album ?? "",
          ]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(normalizedKeyword)) {
            return false;
          }
          return Date.parse(file.modified_at) >= threshold;
        })
      : files.filter((file) => Date.parse(file.modified_at) >= threshold);

    return [...filtered].sort((a, b) => {
      const factor = sort.order === "asc" ? 1 : -1;
      if (sort.key === "file_name") {
        return a.file_name.localeCompare(b.file_name) * factor;
      }
      if (sort.key === "title" || sort.key === "artist" || sort.key === "album") {
        const metadataKey = sort.key;
        const leftValue = (a.metadata[metadataKey] ?? "").trim();
        const rightValue = (b.metadata[metadataKey] ?? "").trim();
        const metadataOrder = leftValue.localeCompare(rightValue, undefined, {
          sensitivity: "base",
          numeric: true,
        });
        if (metadataOrder !== 0) {
          return metadataOrder * factor;
        }
        return a.file_name.localeCompare(b.file_name) * factor;
      }
      if (sort.key === "size_bytes") {
        return (a.size_bytes - b.size_bytes) * factor;
      }
      if (sort.key === "duration_seconds") {
        return ((a.duration_seconds ?? -1) - (b.duration_seconds ?? -1)) * factor;
      }
      return (Date.parse(a.modified_at) - Date.parse(b.modified_at)) * factor;
    });
  }, [response, keyword, sort, timeFilter]);

  const fileNameToIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    sortedFiles.forEach((file, index) => {
      map.set(normalizeFileName(file.file_name), index);
    });
    return map;
  }, [sortedFiles]);

  const selectedSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);

  const selectedCount = selectedFiles.length;
  const effectiveDirectory = response?.directory ?? directory;
  const taskRunning = activeTask?.state === "running";

  const closeTaskOverlay = () => {
    if (taskRunning) {
      return;
    }
    setActiveTask(null);
  };

  const runTask = async (
    title: string,
    startPath: string,
    payload: Record<string, unknown>
  ): Promise<TaskStatusResponse> => {
    const startResult = await fetch(`${API_BASE}${startPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!startResult.ok) {
      const detail = await parseErrorDetail(startResult, "启动任务失败");
      throw new Error(detail);
    }

    const started = (await startResult.json()) as TaskCreateResponse;
    const taskId = started.task_id;

    setActiveTask({
      title,
      taskId,
      taskType: started.task_type,
      state: "running",
      progressPercent: 0,
      currentSubtask: "任务启动中",
      failed: [],
    });

    const eventSource = new EventSource(`${API_BASE}/api/tasks/${taskId}/events`);

    const updateProgressFromEvent = (event: MessageEvent<string>) => {
      try {
        const payloadValue = JSON.parse(event.data) as {
          state?: TaskState;
          progress_percent?: number;
          current_subtask?: string | null;
          failed_count?: number;
        };
        setActiveTask((previous) => {
          if (!previous || previous.taskId !== taskId) {
            return previous;
          }
          return {
            ...previous,
            state: payloadValue.state ?? previous.state,
            progressPercent: payloadValue.progress_percent ?? previous.progressPercent,
            currentSubtask: payloadValue.current_subtask ?? previous.currentSubtask,
          };
        });
      } catch {
        // Ignore malformed event data.
      }
    };

    const updateFailureFromEvent = (event: MessageEvent<string>) => {
      try {
        const payloadValue = JSON.parse(event.data) as { failure?: ScanErrorItem };
        const failure = payloadValue.failure;
        if (!failure) {
          return;
        }
        setActiveTask((previous) => {
          if (!previous || previous.taskId !== taskId) {
            return previous;
          }
          return {
            ...previous,
            failed: uniqueFailures([...previous.failed, failure]),
          };
        });
      } catch {
        // Ignore malformed event data.
      }
    };

    eventSource.addEventListener("status", updateProgressFromEvent as EventListener);
    eventSource.addEventListener("progress", updateProgressFromEvent as EventListener);
    eventSource.addEventListener("completed", updateProgressFromEvent as EventListener);
    eventSource.addEventListener("failed", updateProgressFromEvent as EventListener);
    eventSource.addEventListener("failure", updateFailureFromEvent as EventListener);

    try {
      while (true) {
        const statusResult = await fetch(`${API_BASE}/api/tasks/${taskId}`);
        if (!statusResult.ok) {
          const detail = await parseErrorDetail(statusResult, "查询任务状态失败");
          throw new Error(detail);
        }

        const status = (await statusResult.json()) as TaskStatusResponse;
        setActiveTask((previous) => {
          if (!previous || previous.taskId !== taskId) {
            return previous;
          }
          return {
            ...previous,
            state: status.state,
            progressPercent: status.progress_percent,
            currentSubtask: status.current_subtask ?? "",
            failed: uniqueFailures(status.failed),
          };
        });

        if (status.state !== "running") {
          return status;
        }

        await sleep(250);
      }
    } finally {
      eventSource.close();
    }
  };

  const onSort = (key: SortKey) => {
    setSort((previous) => {
      if (previous.key === key) {
        return { key, order: previous.order === "asc" ? "desc" : "asc" };
      }
      return { key, order: getDefaultSortOrder(key) };
    });
  };

  const runScan = async (
    directoryOverride?: string,
    options?: { resetPanels?: boolean }
  ) => {
    setLoading(true);
    setError(null);

    try {
      const targetDirectory = (directoryOverride ?? directory).trim();
      const status = await runTask("扫描音乐目录", "/api/tasks/scan/start", {
        directory: targetDirectory,
      });

      if (status.state !== "completed" || !status.result) {
        const failedReason = status.failed[0]?.reason ?? "扫描任务失败";
        throw new Error(failedReason);
      }

      const payload = status.result as ScanResponse;
      setResponse(payload);
      setDirectory(payload.directory);
      setSelectedFiles([]);
      setFocusedFile(null);
      setAnchorFile(null);

      const resetPanels = options?.resetPanels ?? true;
      if (resetPanels) {
        setOperationPreview(null);
        setOperationResult(null);
        setDuplicateData(null);
        setDuplicateDecisionMap({});
        setDuplicateResult(null);
      }
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Unknown error");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelectionExplicit = (fileName: string, checked: boolean) => {
    setSelectedFiles((previous) => {
      const exists = previous.includes(fileName);
      if (checked && !exists) {
        return [...previous, fileName];
      }
      if (!checked && exists) {
        return previous.filter((name) => name !== fileName);
      }
      return previous;
    });
  };

  const selectRangeByIndex = (start: number, end: number, checked: boolean) => {
    if (sortedFiles.length === 0) {
      return;
    }
    const low = Math.max(0, Math.min(start, end));
    const high = Math.min(sortedFiles.length - 1, Math.max(start, end));
    const names = sortedFiles.slice(low, high + 1).map((file) => file.file_name);

    setSelectedFiles((previous) => {
      const next = new Set(previous);
      for (const name of names) {
        if (checked) {
          next.add(name);
        } else {
          next.delete(name);
        }
      }
      return Array.from(next);
    });
  };

  const handleRowPointerDown = (fileName: string, index: number, checked: boolean) => {
    if (taskRunning) {
      return;
    }
    setDragSelecting(true);
    setDragSelectionMode(checked ? "select" : "unselect");
    setDragAnchorIndex(index);
    setFocusedFile(fileName);
    setAnchorFile(fileName);
    selectRangeByIndex(index, index, checked);
  };

  const handleRowPointerEnter = (index: number) => {
    if (!dragSelecting || dragAnchorIndex == null || taskRunning) {
      return;
    }
    selectRangeByIndex(dragAnchorIndex, index, dragSelectionMode === "select");
  };

  const handleRowClick = (fileName: string, checked: boolean, index: number, withShiftKey: boolean) => {
    if (taskRunning) {
      return;
    }
    setFocusedFile(fileName);
    if (!withShiftKey || !anchorFile) {
      setAnchorFile(fileName);
      toggleSelectionExplicit(fileName, checked);
      return;
    }

    const anchorIndex = fileNameToIndexMap.get(normalizeFileName(anchorFile));
    if (anchorIndex == null) {
      setAnchorFile(fileName);
      toggleSelectionExplicit(fileName, checked);
      return;
    }

    selectRangeByIndex(anchorIndex, index, checked);
  };

  const selectAllFiltered = () => {
    setSelectedFiles(sortedFiles.map((item) => item.file_name));
  };

  const invertFiltered = () => {
    const filtered = sortedFiles.map((item) => item.file_name);
    const selectedSet = new Set(selectedFiles);
    const inverted = filtered.filter((name) => !selectedSet.has(name));
    setSelectedFiles(inverted);
  };

  const clearSelection = () => {
    setSelectedFiles([]);
  };

  const onTableKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (event.code !== "Space" || taskRunning) {
      return;
    }
    event.preventDefault();

    const targetFile = focusedFile ?? sortedFiles[0]?.file_name;
    if (!targetFile) {
      return;
    }

    const currentlySelected = selectedSet.has(targetFile);
    toggleSelectionExplicit(targetFile, !currentlySelected);
    setAnchorFile(targetFile);

    const row = rowRefs.current[targetFile];
    row?.focus();
  };

  useEffect(() => {
    if (!dragSelecting) {
      return;
    }

    const stopDragSelection = () => {
      setDragSelecting(false);
      setDragAnchorIndex(null);
    };

    window.addEventListener("pointerup", stopDragSelection);
    return () => {
      window.removeEventListener("pointerup", stopDragSelection);
    };
  }, [dragSelecting]);

  useEffect(() => {
    if (!focusedFile) {
      return;
    }
    const stillExists = sortedFiles.some((file) => file.file_name === focusedFile);
    if (!stillExists) {
      setFocusedFile(null);
    }
  }, [focusedFile, sortedFiles]);

  useEffect(() => {
    const enforceSinglePlayingMedia = (event: Event) => {
      const current = event.target;
      if (!(current instanceof HTMLMediaElement)) {
        return;
      }

      const allMedia = document.querySelectorAll<HTMLMediaElement>("audio,video");
      for (const media of allMedia) {
        if (media !== current && !media.paused) {
          media.pause();
        }
      }
    };

    document.addEventListener("play", enforceSinglePlayingMedia, true);
    return () => {
      document.removeEventListener("play", enforceSinglePlayingMedia, true);
    };
  }, []);

  useEffect(() => {
    const updateGlobalScrollActions = () => {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      setShowGlobalScrollActions(pageHeight - viewportHeight > 24);
    };

    updateGlobalScrollActions();

    window.addEventListener("resize", updateGlobalScrollActions);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updateGlobalScrollActions();
          })
        : null;

    if (resizeObserver) {
      resizeObserver.observe(document.documentElement);
      resizeObserver.observe(document.body);
    }

    return () => {
      window.removeEventListener("resize", updateGlobalScrollActions);
      resizeObserver?.disconnect();
    };
  }, []);

  const buildOperationPayload = () => {
    const payload: Record<string, unknown> = {
      directory: effectiveDirectory,
      operation: operationType,
      selected_files: selectedFiles.length > 0 ? selectedFiles : undefined,
    };

    if (operationType === "metadata_fill_from_filename" || operationType === "rename_from_metadata") {
      payload.fill_mode = fillMode;
    }

    if (operationType === "metadata_cleanup") {
      payload.cleanup_pattern = cleanupPattern || null;
      payload.cleanup_use_regex = cleanupUseRegex;
      payload.cleanup_fields = parseCsv(cleanupFieldsInput);
      payload.remove_fields = parseCsv(removeFieldsInput);
    }

    return payload;
  };

  const previewOperation = async () => {
    if (!effectiveDirectory) {
      setOperationError("请先扫描目录。");
      return;
    }

	setOperationError(null);
	setOperationResult(null);

    if (selectedFiles.length === 0) {
	  setOperationPreview(null);
      return;
    }

    setPreviewLoading(true);

    try {
      const result = await fetch(`${API_BASE}/api/operations/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildOperationPayload()),
      });

      if (!result.ok) {
        const payload = (await result.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail ?? "预览失败");
      }

      const payload = (await result.json()) as OperationPreviewResponse;
      setOperationPreview(payload);
    } catch (previewError) {
      setOperationError(previewError instanceof Error ? previewError.message : "预览失败");
	  setOperationPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const executeOperation = async () => {
    if (!effectiveDirectory) {
      setOperationError("请先扫描目录。");
      return;
    }

    setExecuteLoading(true);
    setOperationError(null);

    try {
      const status = await runTask("执行批量操作", "/api/tasks/operations/start", {
        ...(buildOperationPayload() as Record<string, unknown>),
      });

      if (status.state !== "completed" || !status.result) {
        const failedReason = status.failed[0]?.reason ?? "执行失败";
        throw new Error(failedReason);
      }

      const payload = status.result as OperationExecuteResponse;
      setOperationResult(payload);
      if (payload.has_conflict) {
        setOperationError(payload.failed[0]?.reason ?? "检测到冲突，执行已阻断。");
      }

      await runScan(payload.directory, { resetPanels: false });
    } catch (executeError) {
      setOperationError(executeError instanceof Error ? executeError.message : "执行失败");
    } finally {
      setExecuteLoading(false);
    }
  };

  const scanDuplicates = async (
    directoryOverride?: string,
    options?: { resetResult?: boolean }
  ) => {
    const targetDirectory = (directoryOverride ?? effectiveDirectory).trim();

    if (!targetDirectory) {
      setDuplicateError("请先扫描目录。");
      return;
    }

    setDuplicateLoading(true);
    setDuplicateError(null);
    if (options?.resetResult ?? true) {
      setDuplicateResult(null);
    }

    try {
      const result = await fetch(`${API_BASE}/api/duplicates/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ directory: targetDirectory }),
      });

      if (!result.ok) {
        const payload = (await result.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail ?? "去重扫描失败");
      }

      const payload = (await result.json()) as DuplicateScanResponse;
      setDuplicateData(payload);

      const nextMap: Record<string, DuplicateDecisionState> = {};
      for (const group of payload.groups) {
        nextMap[group.group_key] = {
          mode: "ignore",
          keep_file: null,
        };
      }
      setDuplicateDecisionMap(nextMap);
    } catch (dupError) {
      setDuplicateError(dupError instanceof Error ? dupError.message : "去重扫描失败");
      setDuplicateData(null);
      setDuplicateDecisionMap({});
    } finally {
      setDuplicateLoading(false);
    }
  };

  const setDuplicateIgnoreDecision = (groupKey: string) => {
    setDuplicateDecisionMap((previous) => ({
      ...previous,
      [groupKey]: {
        mode: "ignore",
        keep_file: null,
      },
    }));
  };

  const setDuplicateKeepDecision = (groupKey: string, fileName: string) => {
    setDuplicateDecisionMap((previous) => ({
      ...previous,
      [groupKey]: {
        mode: "keep",
        keep_file: fileName,
      },
    }));
  };

  const executeDuplicates = async () => {
    if (!duplicateData) {
      setDuplicateError("请先执行去重扫描。");
      return;
    }

    setDuplicateLoading(true);
    setDuplicateError(null);

    try {
      const invalidGroups = duplicateData.groups
        .filter((group) => {
          const current = duplicateDecisionMap[group.group_key] ?? {
            mode: "ignore" as const,
            keep_file: null,
          };
          return current.mode === "keep" && !current.keep_file;
        })
        .map((group) => group.group_key);

      if (invalidGroups.length > 0) {
        throw new Error(`以下重复组未选择保留文件: ${invalidGroups.join("，")}`);
      }

      const decisions = duplicateData.groups.map((group) => {
        const current = duplicateDecisionMap[group.group_key] ?? {
          mode: "ignore" as const,
          keep_file: null,
        };

        const keepFiles =
          current.mode === "keep" && current.keep_file
            ? [current.keep_file]
            : [];

        return {
          group_key: group.group_key,
          ignore_group: current.mode !== "keep",
          keep_files: keepFiles,
        };
      });

      const status = await runTask("执行去重任务", "/api/tasks/duplicates/start", {
        directory: duplicateData.directory,
        decisions,
      });

      if (status.state !== "completed" || !status.result) {
        const failedReason = status.failed[0]?.reason ?? "去重执行失败";
        throw new Error(failedReason);
      }

      const payload = status.result as DuplicateExecuteResponse;
      setDuplicateResult(payload);

      await runScan(payload.directory, { resetPanels: false });
      await scanDuplicates(payload.directory, { resetResult: false });
    } catch (dupError) {
      setDuplicateError(dupError instanceof Error ? dupError.message : "去重执行失败");
    } finally {
      setDuplicateLoading(false);
    }
  };

  const openMetadataEditor = async (file: MusicFileRecord) => {
    if (!effectiveDirectory) {
      setError("请先扫描目录。");
      return;
    }

    setMetadataOpen(true);
    setMetadataTargetFile(file.file_name);
    setMetadataLoading(true);
    setMetadataSaving(false);
    setMetadataError(null);
    setMetadataNotice(null);
    setMetadataFull(null);
    setMetadataRemoveFieldsInput("");

    try {
      const result = await fetch(`${API_BASE}/api/metadata/read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          directory: effectiveDirectory,
          file_name: file.file_name,
        }),
      });

      if (!result.ok) {
        const detail = await parseErrorDetail(result, "读取元数据失败");
        throw new Error(detail);
      }

      const payload = (await result.json()) as MetadataReadResponse;
      setMetadataFull(payload.full_metadata);

      const tags =
        payload.full_metadata &&
        typeof payload.full_metadata === "object" &&
        "tags" in payload.full_metadata &&
        typeof payload.full_metadata.tags === "object" &&
        payload.full_metadata.tags !== null
          ? (payload.full_metadata.tags as Record<string, unknown>)
          : {};

      const title = firstTagValue(tags.title) || file.metadata.title || "";
      const artist = firstTagValue(tags.artist) || file.metadata.artist || "";
      const album = firstTagValue(tags.album) || file.metadata.album || "";

      setMetadataForm({
        title,
        artist,
        album,
      });

      if (payload.metadata_error) {
        setMetadataNotice(`元数据解析提示: ${payload.metadata_error}`);
      }
    } catch (metaError) {
      setMetadataError(metaError instanceof Error ? metaError.message : "读取元数据失败");
    } finally {
      setMetadataLoading(false);
    }
  };

  const saveMetadata = async () => {
    if (!metadataTargetFile) {
      setMetadataError("缺少目标文件。");
      return;
    }
    if (!effectiveDirectory) {
      setMetadataError("缺少目录信息。");
      return;
    }

    setMetadataSaving(true);
    setMetadataError(null);
    setMetadataNotice(null);

    try {
      const updates: Record<string, string> = {};
      if (metadataForm.title.trim()) {
        updates.title = metadataForm.title.trim();
      }
      if (metadataForm.artist.trim()) {
        updates.artist = metadataForm.artist.trim();
      }
      if (metadataForm.album.trim()) {
        updates.album = metadataForm.album.trim();
      }

      const result = await fetch(`${API_BASE}/api/metadata/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          directory: effectiveDirectory,
          file_name: metadataTargetFile,
          updates,
          remove_fields: parseCsv(metadataRemoveFieldsInput),
        }),
      });

      if (!result.ok) {
        const detail = await parseErrorDetail(result, "写入元数据失败");
        throw new Error(detail);
      }

      const payload = (await result.json()) as MetadataUpdateResponse;

      if (!payload.updated) {
        const firstFailed = payload.failed[0]?.reason ?? "写入元数据失败";
        throw new Error(firstFailed);
      }

      setMetadataNotice("元数据已更新。列表将刷新。");
      await runScan(effectiveDirectory, { resetPanels: false });
    } catch (saveError) {
      setMetadataError(saveError instanceof Error ? saveError.message : "写入元数据失败");
    } finally {
      setMetadataSaving(false);
    }
  };

  const closeMetadataModal = () => {
    if (metadataSaving) {
      return;
    }
    setMetadataOpen(false);
    setMetadataTargetFile(null);
    setMetadataError(null);
    setMetadataNotice(null);
    setMetadataFull(null);
  };

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const scrollToBottom = () => {
    const scrollBottom = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );
    window.scrollTo({
      top: scrollBottom,
      behavior: "smooth",
    });
  };

  return (
    <>
      <main className="page-shell">
        <section className="hero">
          <p className="eyebrow">LOCAL MUSIC OPS</p>
          <h1>Music Conductor</h1>
          <p className="subtitle">
            先扫描，再预览，再执行。已接入任务进度与失败子任务展示，并支持单文件完整元数据查看和编辑。
          </p>
        </section>

        <section className="panel">
          <div className="controls">
            <label htmlFor="directory">音乐目录</label>
            <input
              id="directory"
              type="text"
              placeholder="例如 /Users/you/Music"
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
            />
            <button onClick={() => runScan()} disabled={loading || taskRunning}>
              {loading ? "扫描中..." : "开始扫描"}
            </button>
          </div>

          <div className="toolbar">
            <input
              type="text"
              placeholder="筛选文件名/歌曲名/艺术家/专辑"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              disabled={!response || taskRunning}
            />
            {response ? (
              <p className="result-meta">
                目录: {response.directory} | 扫描到 {response.total_files} 首
              </p>
            ) : (
              <p className="result-meta">等待扫描...</p>
            )}
          </div>

          <div className="time-filter" aria-label="最近修改时间筛选">
            <div className="time-filter-head">
              <label htmlFor="time-filter-slider">最近修改时间</label>
              <p className="result-meta time-filter-current">当前跨度: {getTimeFilterOption(timeFilter).label}</p>
            </div>
            <input
              id="time-filter-slider"
              type="range"
              min={TIME_FILTER_OPTIONS[0].value}
              max={TIME_FILTER_OPTIONS[TIME_FILTER_OPTIONS.length - 1].value}
              value={timeFilter}
              onChange={(event) => setTimeFilter(Number(event.target.value) as TimeFilterValue)}
              step={1}
              disabled={!response || taskRunning}
              list="time-filter-ticks"
              aria-valuemin={TIME_FILTER_OPTIONS[0].value}
              aria-valuemax={TIME_FILTER_OPTIONS[TIME_FILTER_OPTIONS.length - 1].value}
              aria-valuenow={timeFilter}
              aria-valuetext={getTimeFilterOption(timeFilter).label}
            />
            <datalist id="time-filter-ticks">
              {TIME_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} label={option.label} />
              ))}
            </datalist>
          </div>

          <div className="selection-actions">
            <button type="button" onClick={selectAllFiltered} disabled={!response || taskRunning}>全选</button>
            <button type="button" onClick={invertFiltered} disabled={!response || taskRunning}>反选</button>
            <button type="button" onClick={clearSelection} disabled={!response || taskRunning}>全部取消选择</button>
          </div>

          <div className="table-wrap manager-table-wrap" onPointerLeave={() => setDragSelecting(false)}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>
                    <SortHeaderButton label="文件名" sortKey="file_name" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{width: '5em'}}>
                    <SortHeaderButton label="大小" sortKey="size_bytes" sort={sort} onSort={onSort} />
                  </th>
                  <th>
                    <SortHeaderButton label="修改时间" sortKey="modified_at" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{width: '5em'}}>
                    <SortHeaderButton label="时长" sortKey="duration_seconds" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{width: '5em'}}>
                    <SortHeaderButton label="标题" sortKey="title" sort={sort} onSort={onSort} />
                  </th>
                  <th>
                    <SortHeaderButton label="艺术家" sortKey="artist" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{width: '5em'}}>
                    <SortHeaderButton label="专辑" sortKey="album" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{width: '5em'}}>元数据</th>
                </tr>
              </thead>
              <tbody onKeyDown={onTableKeyDown}>
                {sortedFiles.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="empty-cell">
                      {response ? "没有匹配结果" : "请先扫描目录"}
                    </td>
                  </tr>
                ) : (
                  sortedFiles.map((file, index) => (
                    <tr
                      key={file.id}
                      ref={(row) => {
                        rowRefs.current[file.file_name] = row;
                      }}
                      tabIndex={0}
                      data-selected={selectedFiles.includes(file.file_name)}
                      data-file-name={file.file_name}
                      onFocus={() => setFocusedFile(file.file_name)}
                      onPointerDown={(event) => {
                        if (event.pointerType === "touch" || event.pointerType === "pen") {
                          return;
                        }
                        if (event.button !== 0) {
                          return;
                        }
                        const checked = !selectedFiles.includes(file.file_name);
                        handleRowPointerDown(file.file_name, index, checked);
                      }}
                      onPointerEnter={() => handleRowPointerEnter(index)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedFiles.includes(file.file_name)}
                          onChange={(event) =>
                            handleRowClick(
                              file.file_name,
                              event.target.checked,
                              index,
                              Boolean((event.nativeEvent as MouseEvent).shiftKey)
                            )
                          }
                          disabled={taskRunning}
                          aria-label={`选择 ${file.file_name}`}
                          onFocus={() => {
                            setFocusedFile(file.file_name);
                            setAnchorFile(file.file_name);
                          }}
                        />
                      </td>
                      <td>{file.file_name}</td>
                      <td>{formatBytes(file.size_bytes)}</td>
                      <td>{new Date(file.modified_at).toLocaleString()}</td>
                      <td>{formatDuration(file.duration_seconds)}</td>
                      <td>{file.metadata.title ?? "-"}</td>
                      <td>{file.metadata.artist ?? "-"}</td>
                      <td>{file.metadata.album ?? "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="meta-inline-button"
                          onClick={() => openMetadataEditor(file)}
                          disabled={taskRunning}
                        >
                          编辑
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>


          {error ? <p className="error">{error}</p> : null}

          <section className="ops-panel">
            <h2>批量操作（先预览，后执行）</h2>
            <p className="result-meta ops-selected-meta">当前已选 {selectedCount} 首</p>
            <div className="ops-grid">
              <label>
                操作类型
                <select
                  value={operationType}
                  onChange={(event) => setOperationType(event.target.value as OperationType)}
                  disabled={taskRunning}
                >
                  <option value="swap_name_parts">A-B 与 B-A 互换重命名</option>
                  <option value="special_char_replace">特殊字符替换重命名</option>
                  <option value="metadata_fill_from_filename">根据文件名填充元数据</option>
                  <option value="rename_from_metadata">根据元数据修改文件名</option>
                  <option value="metadata_cleanup">清理元数据</option>
                </select>
              </label>

              {operationType === "metadata_fill_from_filename" || operationType === "rename_from_metadata" ? (
                <label>
                  {operationType === "metadata_fill_from_filename" ? "文件名模式" : "重命名模式"}
                  <select
                    value={fillMode}
                    onChange={(event) => setFillMode(event.target.value as "artist_title" | "title_artist")}
                    disabled={taskRunning}
                  >
                    <option value="artist_title">艺术家 - 歌曲名</option>
                    <option value="title_artist">歌曲名 - 艺术家</option>
                  </select>
                </label>
              ) : null}

              {operationType === "metadata_cleanup" ? (
                <>
                  <label>
                    清理字段（逗号分隔）
                    <input
                      value={cleanupFieldsInput}
                      onChange={(event) => setCleanupFieldsInput(event.target.value)}
                      placeholder="title,artist,album"
                      disabled={taskRunning}
                    />
                  </label>
                  <label>
                    清理文本或正则
                    <input
                      value={cleanupPattern}
                      onChange={(event) => setCleanupPattern(event.target.value)}
                      placeholder="例如 feat.|Live"
                      disabled={taskRunning}
                    />
                  </label>
                  <label>
                    删除字段（逗号分隔）
                    <input
                      value={removeFieldsInput}
                      onChange={(event) => setRemoveFieldsInput(event.target.value)}
                      placeholder="例如 album"
                      disabled={taskRunning}
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={cleanupUseRegex}
                      onChange={(event) => setCleanupUseRegex(event.target.checked)}
                      disabled={taskRunning}
                    />
                    使用正则
                  </label>
                </>
              ) : null}
            </div>

            <div className="ops-actions">
              <button type="button" onClick={previewOperation} disabled={previewLoading || !response || taskRunning}>
                {previewLoading ? "预览中..." : "生成变更清单"}
              </button>
              <button
                type="button"
                onClick={executeOperation}
                disabled={
                  executeLoading ||
                  !operationPreview ||
                  operationPreview.items.length === 0 ||
                  operationPreview.has_conflict ||
                  taskRunning
                }
              >
                {executeLoading ? "执行中..." : "执行当前清单"}
              </button>
            </div>

            {operationError ? <p className="error">{operationError}</p> : null}

            {operationPreview ? (
              <div className="preview-block">
                {(() => {
                  const warnings = operationPreview.warnings ?? [];
                  return (
                    <>
                      <p className="result-meta">
                        清单项 {operationPreview.items.length} | 冲突 {operationPreview.conflict_count} | 跳过 {warnings.length}
                      </p>

                      {warnings.length > 0 ? (
                        <details className="skipped">
                          <summary>元数据缺失或异常 {warnings.length} 项（未加入清单）</summary>
                          <ul>
                            {warnings.map((item, index) => (
                              <li key={`${item.file_name}-${index}`}>{item.file_name}: {item.reason}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </>
                  );
                })()}
                <p className="result-meta">
                  预览结果
                </p>
                <div className="table-wrap compact-table">
                  <table>
                    <thead>
                      <tr>
                        <th>动作</th>
                        <th>类型</th>
                        <th>源文件</th>
                        <th>目标文件/变更</th>
                        <th style={{width: '5em'}}>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operationPreview.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="empty-cell">没有需要变更的项</td>
                        </tr>
                      ) : (
                        operationPreview.items.map((item) => (
                          <tr key={item.id} className={item.conflict ? "conflict-row" : undefined}>
                            <td>{item.action}</td>
                            <td>{item.target_type}</td>
                            <td>{item.source_file ?? "-"}</td>
                            <td>
                              {item.action === "metadata_update"
                                ? item.metadata_changes
                                    .map((change) => `${change.field}: ${change.old_value ?? "-"} -> ${change.new_value ?? "<清空>"}`)
                                    .join(" | ")
                                : item.destination_file ?? "-"}
                            </td>
                            <td>{item.conflict ? item.conflict_reason ?? "冲突" : "可执行"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {operationResult ? (
              <div className="result-chip">
                <p>执行完成：成功 {operationResult.executed.length} 项，失败 {operationResult.failed.length} 项。</p>
                {operationResult.failed.length > 0 ? (
                  <ul>
                    {operationResult.failed.map((item, index) => (
                      <li key={`${item.file_name}-${index}`}>{item.file_name}: {item.reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="dup-panel">
            <h2>去重</h2>
            <div className="ops-actions">
              <button type="button" onClick={() => scanDuplicates()} disabled={duplicateLoading || !response || taskRunning}>
                {duplicateLoading ? "扫描中..." : "扫描重复组"}
              </button>
              <button
                type="button"
                onClick={executeDuplicates}
                disabled={duplicateLoading || !duplicateData || duplicateData.groups.length === 0 || taskRunning}
              >
                {duplicateLoading ? "处理中..." : "执行去重决策"}
              </button>
            </div>

            {duplicateError ? <p className="error">{duplicateError}</p> : null}

            {duplicateData ? (
              <div className="dup-groups">
                <p className="result-meta">
                  重复组 {duplicateData.groups.length} | .mcignore 记录 {duplicateData.ignored_files.length}
                </p>

                {duplicateData.groups.length === 0 ? (
                  <p className="result-meta">当前没有重复组。</p>
                ) : (
                  duplicateData.groups.map((group) => {
                    const decision = duplicateDecisionMap[group.group_key] ?? {
                      mode: "ignore" as const,
                      keep_file: null,
                    };

                    const decisionRadioName = `duplicate-decision-${group.group_key}`;

                    return (
                      <details key={group.group_key} className="group-card" open>
                        <summary>
                          组键: {group.group_key} | 文件数: {group.files.length}
                        </summary>

                        <fieldset className="group-decision" disabled={taskRunning}>
                          <legend>选择保留</legend>

                          <label className="radio-label">
                            <input
                              type="radio"
                              name={decisionRadioName}
                              checked={decision.mode === "ignore"}
                              onChange={() => setDuplicateIgnoreDecision(group.group_key)}
                            />
                            保留所有并忽略
                          </label>

                          <div className="group-files">
                            {group.files.map((file) => (
                              <div key={file.file_name} className="group-file-item">
                                <label className="radio-label">
                                  <input
                                    type="radio"
                                    name={decisionRadioName}
                                    checked={decision.mode === "keep" && decision.keep_file === file.file_name}
                                    onChange={() => setDuplicateKeepDecision(group.group_key, file.file_name)}
                                  />
                                  {file.file_name} ({formatBytes(file.size_bytes)}, {file.extension}, {formatDuration(file.duration_seconds)})
                                  {file.has_lrc ? " [lrc]" : ""}
                                </label>

                                <InlineAudioPreview
                                  playerId={`${group.group_key}-${file.file_name}`}
                                  sourceUrl={buildMediaPreviewUrl(duplicateData.directory, file.file_name)}
                                />
                              </div>
                            ))}
                          </div>
                        </fieldset>
                      </details>
                    );
                  })
                )}
              </div>
            ) : null}

            {duplicateResult ? (
              <div className="result-chip">
                <p>
                  去重完成：删除 {duplicateResult.deleted_files.length}，lrc 迁移 {duplicateResult.lrc_renamed.length}，lrc 删除 {duplicateResult.lrc_deleted.length}，
                  ignore 新增 {duplicateResult.ignored_written.length}，失败 {duplicateResult.failed.length}。
                </p>
              </div>
            ) : null}
          </section>

          {response?.skipped.length ? (
            <details className="skipped">
              <summary>元数据读取失败 {response.skipped.length} 项</summary>
              <ul>
                {response.skipped.map((item, index) => (
                  <li key={`${item.file_name}-${index}`}>
                    {item.file_name}: {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </main>

      {showGlobalScrollActions ? (
        <div className="global-scroll-actions" aria-label="页面滚动快捷操作">
          <button type="button" className="scroll-shortcut" onClick={scrollToTop}>
            回到顶部
          </button>
          <button type="button" className="scroll-shortcut" onClick={scrollToBottom}>
            滚到底部
          </button>
        </div>
      ) : null}

      {activeTask ? (
        <div className="task-overlay" role="dialog" aria-modal="true">
          <div className="task-card">
            <p className="eyebrow">TASK PROGRESS</p>
            <h2>{activeTask.title}</h2>
            <p className="result-meta">任务类型: {activeTask.taskType} | 任务 ID: {activeTask.taskId}</p>

            <div className="task-progress-track">
              <div
                className={`task-progress-fill task-${activeTask.state}`}
                style={{ width: `${Math.max(0, Math.min(100, activeTask.progressPercent))}%` }}
              />
            </div>

            <p className="task-progress-text">
              {activeTask.progressPercent.toFixed(2)}% · {activeTask.currentSubtask || "执行中"}
            </p>

            <details className="task-failures" open>
              <summary>失败子任务 {activeTask.failed.length} 项</summary>
              {activeTask.failed.length === 0 ? (
                <p className="result-meta">暂无失败子任务。</p>
              ) : (
                <ul>
                  {activeTask.failed.map((item, index) => (
                    <li key={`${item.file_name}-${item.reason}-${index}`}>{item.file_name}: {item.reason}</li>
                  ))}
                </ul>
              )}
            </details>

            <div className="task-footer">
              {activeTask.state === "running" ? (
                <p className="result-meta">任务进行中，界面已阻塞，暂不支持取消。</p>
              ) : (
                <button type="button" onClick={closeTaskOverlay}>关闭任务面板</button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {metadataOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-head">
              <h2>元数据详情与编辑</h2>
              <button type="button" onClick={closeMetadataModal} disabled={metadataSaving}>关闭</button>
            </div>

            <p className="result-meta">目标文件: {metadataTargetFile ?? "-"}</p>

            {metadataError ? <p className="error">{metadataError}</p> : null}
            {metadataNotice ? <p className="notice">{metadataNotice}</p> : null}

            {metadataLoading ? (
              <p className="result-meta">读取元数据中...</p>
            ) : (
              <>
                <div className="modal-grid">
                  <label>
                    标题
                    <input
                      type="text"
                      value={metadataForm.title}
                      onChange={(event) => setMetadataForm((prev) => ({ ...prev, title: event.target.value }))}
                      disabled={metadataSaving}
                    />
                  </label>
                  <label>
                    艺术家
                    <input
                      type="text"
                      value={metadataForm.artist}
                      onChange={(event) => setMetadataForm((prev) => ({ ...prev, artist: event.target.value }))}
                      disabled={metadataSaving}
                    />
                  </label>
                  <label>
                    专辑
                    <input
                      type="text"
                      value={metadataForm.album}
                      onChange={(event) => setMetadataForm((prev) => ({ ...prev, album: event.target.value }))}
                      disabled={metadataSaving}
                    />
                  </label>
                  <label>
                    删除字段（逗号分隔）
                    <input
                      type="text"
                      value={metadataRemoveFieldsInput}
                      onChange={(event) => setMetadataRemoveFieldsInput(event.target.value)}
                      placeholder="例如 album"
                      disabled={metadataSaving}
                    />
                  </label>
                </div>

                <div className="ops-actions">
                  <button type="button" onClick={saveMetadata} disabled={metadataSaving}>
                    {metadataSaving ? "保存中..." : "保存元数据"}
                  </button>
                </div>

                <details className="raw-metadata" open>
                  <summary>完整元数据原始视图</summary>
                  <pre>{JSON.stringify(metadataFull ?? {}, null, 2)}</pre>
                </details>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
