import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import InlineAudioPreview from "./components/InlineAudioPreview";
import SortHeaderButton from "./components/SortHeaderButton";
import type {
  ActiveTask,
  DirectorySuggestResponse,
  DuplicateDecisionState,
  DuplicateExecuteResponse,
  DuplicateScanResponse,
  MetadataReadResponse,
  MetadataUpdateResponse,
  MusicFileRecord,
  OperationExecuteResponse,
  OperationPreviewResponse,
  OperationType,
  RuntimeConfigResponse,
  ScanErrorItem,
  ScanResponse,
  SortKey,
  SortState,
  SpecialCharMapRow,
  TaskCreateResponse,
  TaskState,
  TaskStatusResponse,
} from "./types";
import {
  API_BASE,
  buildDirectorySuggestUrl,
  buildMediaPreviewUrl,
  firstTagValue,
  formatBytes,
  formatDuration,
  getDefaultSortOrder,
  getTimeFilterOption,
  normalizeFileName,
  parseCsv,
  parseErrorDetail,
  sleep,
  TIME_FILTER_OPTIONS,
  type TimeFilterValue,
  uniqueFailures,
} from "./utils/appHelpers";

export default function App() {
  const [directory, setDirectory] = useState("");
  const [directorySuggestions, setDirectorySuggestions] = useState<string[]>([]);
  const [showDirectorySuggestions, setShowDirectorySuggestions] = useState(false);
  const [directorySuggestionIndex, setDirectorySuggestionIndex] = useState(-1);
  const [keyword, setKeyword] = useState("");
  const [keywordCaseSensitive, setKeywordCaseSensitive] = useState(false);
  const [keywordUseRegex, setKeywordUseRegex] = useState(false);
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
  const directorySuggestAbortRef = useRef<AbortController | null>(null);
  const directorySuggestTimerRef = useRef<number | null>(null);
  const directorySuggestContainerRef = useRef<HTMLDivElement | null>(null);

  const [operationType, setOperationType] = useState<OperationType>("swap_name_parts");
  const specialCharRowSeed = useRef(1);
  const [specialCharMapRows, setSpecialCharMapRows] = useState<SpecialCharMapRow[]>([
    { id: "special-char-row-1", from: "", to: "" },
  ]);
  const [fillMode, setFillMode] = useState<"artist_title" | "title_artist">("artist_title");
  const [cleanupPattern, setCleanupPattern] = useState("");
  const [cleanupUseRegex, setCleanupUseRegex] = useState(false);
  const [cleanupCaseSensitive, setCleanupCaseSensitive] = useState(false);
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
  const [floatingPlayerFileName, setFloatingPlayerFileName] = useState<string | null>(null);
  const [floatingPlayerSourceUrl, setFloatingPlayerSourceUrl] = useState<string | null>(null);
  const [floatingPlayerAutoPlayToken, setFloatingPlayerAutoPlayToken] = useState(0);

  const keywordRegexError = useMemo(() => {
    const trimmed = keyword.trim();
    if (!keywordUseRegex || trimmed.length === 0) {
      return null;
    }

    try {
      void new RegExp(trimmed, keywordCaseSensitive ? "" : "i");
      return null;
    } catch {
      return "正则表达式无效";
    }
  }, [keyword, keywordUseRegex, keywordCaseSensitive]);

  const sortedFiles = useMemo(() => {
    const files = response?.files ?? [];
    const trimmedKeyword = keyword.trim();
    const thresholdOption = getTimeFilterOption(timeFilter);
    const threshold =
      thresholdOption.ms === Number.POSITIVE_INFINITY ? -Number.POSITIVE_INFINITY : Date.now() - thresholdOption.ms;
    let keywordMatcher: ((value: string) => boolean) | null = null;

    if (trimmedKeyword.length > 0) {
      if (keywordUseRegex) {
        if (keywordRegexError) {
          keywordMatcher = () => false;
        } else {
          const regex = new RegExp(trimmedKeyword, keywordCaseSensitive ? "" : "i");
          keywordMatcher = (value) => regex.test(value);
        }
      } else {
        const expected = keywordCaseSensitive ? trimmedKeyword : trimmedKeyword.toLowerCase();
        keywordMatcher = (value) => {
          const source = keywordCaseSensitive ? value : value.toLowerCase();
          return source.includes(expected);
        };
      }
    }

    const filtered = files.filter((file) => {
      if (Date.parse(file.modified_at) < threshold) {
        return false;
      }

      if (!keywordMatcher) {
        return true;
      }

      const haystack = [
        file.file_name,
        file.format,
        file.metadata.title ?? "",
        file.metadata.artist ?? "",
        file.metadata.album ?? "",
      ].join(" ");
      return keywordMatcher(haystack);
    });

    return [...filtered].sort((a, b) => {
      const factor = sort.order === "asc" ? 1 : -1;
      if (sort.key === "file_name") {
        return a.file_name.localeCompare(b.file_name) * factor;
      }
      if (sort.key === "format") {
        const formatOrder = a.format.localeCompare(b.format, undefined, {
          sensitivity: "base",
          numeric: true,
        });
        if (formatOrder !== 0) {
          return formatOrder * factor;
        }
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
  }, [response, keyword, sort, timeFilter, keywordCaseSensitive, keywordUseRegex, keywordRegexError]);

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

  const hideDirectorySuggestions = () => {
    setShowDirectorySuggestions(false);
    setDirectorySuggestionIndex(-1);
  };

  const applyDirectorySuggestion = (nextDirectory: string) => {
    setDirectory(nextDirectory);
    hideDirectorySuggestions();
  };

  const openFloatingPlayer = (fileName: string, sourceUrl: string) => {
    setFloatingPlayerFileName(fileName);
    setFloatingPlayerSourceUrl(sourceUrl);
    setFloatingPlayerAutoPlayToken((previous) => previous + 1);
  };

  useEffect(() => {
    const loadDefaultDirectory = async () => {
      try {
        const result = await fetch(`${API_BASE}/api/config`);
        if (!result.ok) {
          return;
        }
        const payload = (await result.json()) as RuntimeConfigResponse;
        if (!payload.default_music_dir) {
          return;
        }

        setDirectory((previous) => (previous.trim().length > 0 ? previous : payload.default_music_dir ?? ""));
      } catch {
        // Ignore config bootstrap failure and allow manual input.
      }
    };

    void loadDefaultDirectory();
  }, []);

  useEffect(() => {
    const trimmed = directory.trim();
    if (!trimmed) {
      setDirectorySuggestions([]);
      hideDirectorySuggestions();
      return;
    }

    if (directorySuggestTimerRef.current != null) {
      window.clearTimeout(directorySuggestTimerRef.current);
    }

    directorySuggestTimerRef.current = window.setTimeout(() => {
      directorySuggestAbortRef.current?.abort();
      const controller = new AbortController();
      directorySuggestAbortRef.current = controller;

      void (async () => {
        try {
          const result = await fetch(buildDirectorySuggestUrl(trimmed), {
            signal: controller.signal,
          });

          if (!result.ok) {
            setDirectorySuggestions([]);
            hideDirectorySuggestions();
            return;
          }

          const payload = (await result.json()) as DirectorySuggestResponse;
          setDirectorySuggestions(payload.candidates);
          setDirectorySuggestionIndex(-1);
          setShowDirectorySuggestions(payload.candidates.length > 0);
        } catch (requestError) {
          if (requestError instanceof DOMException && requestError.name === "AbortError") {
            return;
          }
          setDirectorySuggestions([]);
          hideDirectorySuggestions();
        }
      })();
    }, 150);

    return () => {
      if (directorySuggestTimerRef.current != null) {
        window.clearTimeout(directorySuggestTimerRef.current);
      }
      directorySuggestAbortRef.current?.abort();
    };
  }, [directory]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (directorySuggestContainerRef.current?.contains(target)) {
        return;
      }
      hideDirectorySuggestions();
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

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

  const updateSpecialCharMapRow = (rowId: string, field: "from" | "to", value: string) => {
    setSpecialCharMapRows((previous) =>
      previous.map((row) => (row.id === rowId ? { ...row, [field]: value } : row))
    );
  };

  const addSpecialCharMapRow = () => {
    specialCharRowSeed.current += 1;
    setSpecialCharMapRows((previous) => [
      ...previous,
      {
        id: `special-char-row-${specialCharRowSeed.current}`,
        from: "",
        to: "",
      },
    ]);
  };

  const removeSpecialCharMapRow = (rowId: string) => {
    setSpecialCharMapRows((previous) => {
      if (previous.length <= 1) {
        return previous.map((row) =>
          row.id === rowId
            ? {
                ...row,
                from: "",
                to: "",
              }
            : row
        );
      }

      return previous.filter((row) => row.id !== rowId);
    });
  };

  const buildSpecialCharMap = (): Record<string, string> => {
    const mapping: Record<string, string> = {};
    for (const row of specialCharMapRows) {
      if (!row.from) {
        continue;
      }
      mapping[row.from] = row.to;
    }
    return mapping;
  };

  const onDirectoryInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showDirectorySuggestions || directorySuggestions.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
        void runScan();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDirectorySuggestionIndex((previous) => {
        const next = previous + 1;
        if (next >= directorySuggestions.length) {
          return 0;
        }
        return next;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setDirectorySuggestionIndex((previous) => {
        const next = previous - 1;
        if (next < 0) {
          return directorySuggestions.length - 1;
        }
        return next;
      });
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      hideDirectorySuggestions();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (directorySuggestionIndex >= 0 && directorySuggestionIndex < directorySuggestions.length) {
        applyDirectorySuggestion(directorySuggestions[directorySuggestionIndex]);
      } else {
        void runScan();
      }
    }
  };

  const runScan = async (
    directoryOverride?: string,
    options?: { resetPanels?: boolean }
  ) => {
    setLoading(true);
    setError(null);
    hideDirectorySuggestions();

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

  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return Boolean(target.closest("button, input, select, textarea, a, label"));
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

  const onTableKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
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
    if (!floatingPlayerFileName || !response) {
      return;
    }
    const stillExists = response.files.some((item) => item.file_name === floatingPlayerFileName);
    if (!stillExists) {
      setFloatingPlayerFileName(null);
      setFloatingPlayerSourceUrl(null);
    }
  }, [floatingPlayerFileName, response]);

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

    if (operationType === "special_char_replace") {
      const specialCharMap = buildSpecialCharMap();
      if (Object.keys(specialCharMap).length > 0) {
        payload.special_char_map = specialCharMap;
      }
    }

    if (operationType === "metadata_fill_from_filename" || operationType === "rename_from_metadata") {
      payload.fill_mode = fillMode;
    }

    if (operationType === "metadata_cleanup_text") {
      payload.cleanup_pattern = cleanupPattern || null;
      payload.cleanup_use_regex = cleanupUseRegex;
      payload.cleanup_case_sensitive = cleanupCaseSensitive;
      payload.cleanup_fields = parseCsv(cleanupFieldsInput);
    }

    if (operationType === "metadata_cleanup_remove_fields") {
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

    if (operationType === "metadata_cleanup_text" && !cleanupPattern.trim()) {
      setOperationError("请填写待清理文本。");
      setOperationPreview(null);
      return;
    }

    if (operationType === "metadata_cleanup_remove_fields" && parseCsv(removeFieldsInput).length === 0) {
      setOperationError("请至少填写一个待删除字段。");
      setOperationPreview(null);
      return;
    }

    if (selectedFiles.length === 0) {
      setOperationError("请先选择至少一个文件。");
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
            先扫描音乐目录，完成后即可对音乐文件进行批量重命名、元数据编辑、特殊字符替换等操作，也可以扫描并处理重复文件。
          </p>
        </section>

        <section className="panel">
          <div className="controls" ref={directorySuggestContainerRef}>
            <label htmlFor="directory">音乐目录</label>
            <input
              id="directory"
              name="directory"
              type="text"
              placeholder="例如 /Users/you/Music"
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              onFocus={() => {
                if (directorySuggestions.length > 0) {
                  setShowDirectorySuggestions(true);
                }
              }}
              onBlur={() => {
                window.setTimeout(() => {
                  hideDirectorySuggestions();
                }, 100);
              }}
              onKeyDown={onDirectoryInputKeyDown}
              autoComplete={directory.trim().length === 0 ? "on" : "off"}
            />
            <button onClick={() => runScan()} disabled={loading || taskRunning}
				aria-label={loading ? '扫描中...' : '开始扫描'}
				title={loading ? '扫描中...' : '开始扫描'}
            >
              <span className="iconfont icon-search-folder" aria-hidden="true" />
            </button>

            {showDirectorySuggestions && directorySuggestions.length > 0 ? (
              <ul className="directory-suggestions" role="listbox" aria-label="目录补全候选">
                {directorySuggestions.map((item, index) => (
                  <li key={item} role="option" aria-selected={directorySuggestionIndex === index}>
                    <button
                      type="button"
                      className={`directory-suggestion-item${directorySuggestionIndex === index ? " is-active" : ""}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyDirectorySuggestion(item);
                      }}
                    >
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="toolbar">
            <div className="keyword-input-wrap">
              <input
                type="text"
                placeholder="筛选文件名/歌曲名/艺术家/专辑"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                disabled={!response || taskRunning}
              />
              <div className="keyword-mode-switches" aria-label="文本筛选模式">
                <button
                  type="button"
                  className={`keyword-mode-btn${keywordCaseSensitive ? " is-active" : ""}`}
                  onClick={() => setKeywordCaseSensitive((previous) => !previous)}
                  disabled={!response || taskRunning}
                  aria-label="大小写敏感筛选"
                  aria-pressed={keywordCaseSensitive}
                  title={keywordCaseSensitive ? "大小写敏感：开启" : "大小写敏感：关闭"}
                >
                  <span className="iconfont icon-case-sensitive" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`keyword-mode-btn${keywordUseRegex ? " is-active" : ""}`}
                  onClick={() => setKeywordUseRegex((previous) => !previous)}
                  disabled={!response || taskRunning}
                  aria-label="正则表达式筛选"
                  aria-pressed={keywordUseRegex}
                  title={keywordUseRegex ? "正则表达式：开启" : "正则表达式：关闭"}
                >
                  <span className="iconfont icon-regexp" aria-hidden="true" />
                </button>
              </div>
            </div>
            {response ? (
              <p className="result-meta">
                目录: {response.directory} | 扫描到 {response.total_files} 首
              </p>
            ) : (
              <p className="result-meta">等待扫描...</p>
            )}
          </div>

          {keywordRegexError ? <p className="filter-error">{keywordRegexError}</p> : null}

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
            <button
              type="button"
              className="icon-only-btn"
              onClick={selectAllFiltered}
              disabled={!response || taskRunning}
              aria-label="全选"
              title="全选"
            >
              <span className="iconfont icon-selected" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-only-btn"
              onClick={invertFiltered}
              disabled={!response || taskRunning}
              aria-label="反选"
              title="反选"
            >
              <span className="iconfont icon-swap-bw" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-only-btn"
              onClick={clearSelection}
              disabled={!response || taskRunning}
              aria-label="全部取消选择"
              title="全部取消选择"
            >
              <span className="iconfont icon-close" aria-hidden="true" />
            </button>
          </div>

          <div className="table-wrap manager-table-wrap" onPointerLeave={() => setDragSelecting(false)}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>
                    <SortHeaderButton label="文件名" sortKey="file_name" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{width: '6em'}}>
                    <SortHeaderButton label="格式" sortKey="format" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{width: '6em'}}>
                    <SortHeaderButton label="大小" sortKey="size_bytes" sort={sort} onSort={onSort} />
                  </th>
                  <th>
                    <SortHeaderButton label="修改时间" sortKey="modified_at" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{width: '6em'}}>
                    <SortHeaderButton label="时长" sortKey="duration_seconds" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{minWidth: '6em'}}>
                    <SortHeaderButton label="标题" sortKey="title" sort={sort} onSort={onSort} />
                  </th>
                  <th>
                    <SortHeaderButton label="艺术家" sortKey="artist" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{minWidth: '6em'}}>
                    <SortHeaderButton label="专辑" sortKey="album" sort={sort} onSort={onSort} />
                  </th>
                  <th style={{width: '5em'}}>元数据</th>
                </tr>
              </thead>
              <tbody onKeyDown={onTableKeyDown}>
                {sortedFiles.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="empty-cell">
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

                        if (isInteractiveTarget(event.target)) {
                          return;
                        }

                        if (event.shiftKey) {
                          handleRowClick(file.file_name, true, index, true);
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
                      <td>
                        <div className="file-name-cell">
                          <span>{file.file_name}</span>
                          <button
                            type="button"
                            className="row-play-btn icon-only-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              openFloatingPlayer(
                                file.file_name,
                                buildMediaPreviewUrl(effectiveDirectory, file.file_name)
                              );
                            }}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                            disabled={taskRunning}
                            aria-label={`播放 ${file.file_name}`}
                            title="播放"
                          >
                            <span className="iconfont icon-play" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                      <td>{file.format || "-"}</td>
                      <td>{formatBytes(file.size_bytes)}</td>
                      <td>{new Date(file.modified_at).toLocaleString()}</td>
                      <td>{formatDuration(file.duration_seconds)}</td>
                      <td>{file.metadata.title ?? "-"}</td>
                      <td>{file.metadata.artist ?? "-"}</td>
                      <td>{file.metadata.album ?? "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="meta-inline-button icon-only-btn"
                          onClick={() => openMetadataEditor(file)}
                          disabled={taskRunning}
                          aria-label={`编辑 ${file.file_name} 的元数据`}
                          title="编辑元数据"
                        >
                          <span className="iconfont icon-edit" aria-hidden="true" />
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
                  <option value="swap_name_parts">文件名 A-B 与 B-A 风格互换</option>
                  <option value="special_char_replace">特殊字符替换重命名</option>
                  <option value="fix_extension_by_format">批量修复扩展名（按检测格式）</option>
                  <option value="metadata_fill_from_filename">根据文件名填充元数据</option>
                  <option value="rename_from_metadata">根据元数据修改文件名</option>
                  <option value="metadata_cleanup_text">清理元数据文本（支持正则/大小写）</option>
                  <option value="metadata_cleanup_remove_fields">删除元数据字段</option>
                </select>
              </label>

              {operationType === "special_char_replace" ? (
                <div className="special-char-map-editor">
                  <p className="result-meta">
                    可选：自定义映射表（留空则使用后端默认映射；填写后将覆盖默认映射）。
                  </p>

                  <div className="special-char-map-list" role="group" aria-label="特殊字符映射表">
                    {specialCharMapRows.map((row, index) => (
                      <div className="special-char-map-row" key={row.id}>
                        <input
                          value={row.from}
                          onChange={(event) => updateSpecialCharMapRow(row.id, "from", event.target.value)}
                          placeholder="源字符，例如 _"
                          disabled={taskRunning}
                          aria-label={`映射 ${index + 1} 的源字符`}
                        />
                        <input
                          value={row.to}
                          onChange={(event) => updateSpecialCharMapRow(row.id, "to", event.target.value)}
                          placeholder="目标字符，例如 空格"
                          disabled={taskRunning}
                          aria-label={`映射 ${index + 1} 的目标字符`}
                        />
                        <button
                          type="button"
                          onClick={() => removeSpecialCharMapRow(row.id)}
                          disabled={taskRunning}
                          aria-label={`删除映射 ${index + 1}`}
                          title="删除映射"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="ops-secondary-btn"
                    onClick={addSpecialCharMapRow}
                    disabled={taskRunning}
                  >
                    新增映射
                  </button>
                </div>
              ) : null}

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

              {operationType === "metadata_cleanup_text" ? (
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
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={cleanupUseRegex}
                      onChange={(event) => setCleanupUseRegex(event.target.checked)}
                      disabled={taskRunning}
                    />
                    使用正则
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={cleanupCaseSensitive}
                      onChange={(event) => setCleanupCaseSensitive(event.target.checked)}
                      disabled={taskRunning}
                    />
                    大小写敏感
                  </label>
                </>
              ) : null}

              {operationType === "metadata_cleanup_remove_fields" ? (
                <label>
                  删除字段（逗号分隔）
                  <input
                    value={removeFieldsInput}
                    onChange={(event) => setRemoveFieldsInput(event.target.value)}
                    placeholder="例如 album,comment,lyrics"
                    disabled={taskRunning}
                  />
                </label>
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
                          <summary>警告与跳过 {warnings.length} 项（未加入清单）</summary>
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

      {floatingPlayerSourceUrl && floatingPlayerFileName ? (
        <div className="floating-audio-dock" aria-label="全局播放器">
          <div className="floating-audio-head">
            <p className="floating-audio-title" title={floatingPlayerFileName}>{floatingPlayerFileName}</p>
            <button
              type="button"
              className="icon-only-btn floating-audio-close"
              onClick={() => {
                setFloatingPlayerFileName(null);
                setFloatingPlayerSourceUrl(null);
              }}
              aria-label="关闭全局播放器"
              title="关闭"
            >
              <span className="iconfont icon-close" aria-hidden="true" />
            </button>
          </div>

          <InlineAudioPreview
            playerId="global-floating-player"
            sourceUrl={floatingPlayerSourceUrl}
            autoPlayToken={floatingPlayerAutoPlayToken}
            className="floating-audio-inline"
          />
        </div>
      ) : null}

      {showGlobalScrollActions ? (
        <div className="global-scroll-actions" aria-label="页面滚动快捷操作">
          <button
            type="button"
            className="scroll-shortcut icon-only-btn"
            onClick={scrollToTop}
            aria-label="回到顶部"
            title="回到顶部"
          >
            <span className="iconfont icon-top" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="scroll-shortcut icon-only-btn"
            onClick={scrollToBottom}
            aria-label="滚到底部"
            title="滚到底部"
          >
            <span className="iconfont icon-bottom" aria-hidden="true" />
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
