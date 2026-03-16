import type { ScanErrorItem, SortKey, SortState } from "../types";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export const getDefaultSortOrder = (key: SortKey): SortState["order"] => {
  if (key === "file_name" || key === "format" || key === "title" || key === "artist" || key === "album") {
    return "asc";
  }
  return "desc";
};

export const formatBytes = (value: number): string => {
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

export const formatDuration = (value?: number | null): string => {
  if (value == null) {
    return "-";
  }
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
};

export const sleep = async (ms: number) => {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
};

export const uniqueFailures = (items: ScanErrorItem[]): ScanErrorItem[] => {
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

export const firstTagValue = (value: unknown): string => {
  if (Array.isArray(value) && value.length > 0) {
    return String(value[0] ?? "");
  }
  if (value == null) {
    return "";
  }
  return String(value);
};

export const parseErrorDetail = async (result: Response, fallback: string): Promise<string> => {
  const payload = (await result.json().catch(() => null)) as { detail?: string } | null;
  return payload?.detail ?? fallback;
};

export const parseCsv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export const TIME_FILTER_OPTIONS = [
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

export type TimeFilterValue = (typeof TIME_FILTER_OPTIONS)[number]["value"];

export const getTimeFilterOption = (value: TimeFilterValue) =>
  TIME_FILTER_OPTIONS.find((item) => item.value === value) ?? TIME_FILTER_OPTIONS[0];

export const normalizeFileName = (fileName: string) => fileName.toLowerCase().trim();

export const buildMediaPreviewUrl = (directory: string, fileName: string): string => {
  const params = new URLSearchParams({
    directory,
    file_name: fileName,
  });
  return `${API_BASE}/api/media/preview?${params.toString()}`;
};
