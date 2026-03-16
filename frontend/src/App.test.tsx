import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  createFetchMock,
  createScanResult,
  createTaskStatus,
  getLatestEventSource,
  installEventSourceMock,
} from "./test/testUtils";

const startButtonText = "开始扫描";

const getStatusUrl = (taskId: string) => `http://127.0.0.1:8000/api/tasks/${taskId}`;

const getEventsUrl = (taskId: string) => `http://127.0.0.1:8000/api/tasks/${taskId}/events`;

describe("App integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installEventSourceMock();
  });

  afterEach(() => {
    cleanup();
  });

  it("covers task flow: start, progress, failure, completed and blocking behavior", async () => {
    const taskId = "task-001";
    const scanResult = createScanResult();

    let statusCallCount = 0;

    createFetchMock([
      ({ url, method }) => {
        if (url.endsWith("/api/tasks/scan/start") && method === "POST") {
          return {
            body: { task_id: taskId, task_type: "scan" },
          };
        }
        return null as never;
      },
      ({ url, method }) => {
        if (url === getStatusUrl(taskId) && method === "GET") {
          statusCallCount += 1;
          if (statusCallCount === 1) {
            return {
              body: createTaskStatus({
                task_id: taskId,
                state: "running",
                progress_percent: 10,
                current_subtask: "准备扫描",
                result: undefined,
              }),
            };
          }

          return {
            body: createTaskStatus({
              task_id: taskId,
              state: "completed",
              progress_percent: 100,
              current_subtask: "扫描完成",
              result: scanResult,
            }),
          };
        }
        return null as never;
      },
    ]);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: startButtonText }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("扫描音乐目录")).toBeInTheDocument();
    expect(within(dialog).getByText(/任务进行中，界面已阻塞/)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "全选" })).toBeDisabled();
    expect(screen.getByPlaceholderText("筛选文件名/歌曲名/艺术家/专辑")).toBeDisabled();

    const eventSource = getLatestEventSource();
    expect(eventSource).not.toBeNull();
    expect(eventSource?.url).toBe(getEventsUrl(taskId));

    eventSource?.emit("progress", {
      state: "running",
      progress_percent: 47,
      current_subtask: "扫描文件: A - Song 1.mp3",
      failed_count: 0,
    });

    await screen.findByText(/47\.00%/);
    await screen.findByText(/扫描文件: A - Song 1\.mp3/);

    eventSource?.emit("failure", {
      failure: {
        file_name: "C - Song 3.ogg",
        reason: "读取元数据失败",
      },
    });

    await screen.findByText("C - Song 3.ogg: 读取元数据失败");

    await waitFor(() => {
      expect(screen.getByText(/扫描到 3 首/)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "关闭任务面板" })).toBeEnabled();
    });

    expect(eventSource?.closed).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "关闭任务面板" }));
    await waitFor(() => {
      expect(screen.queryByText("TASK PROGRESS")).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "全选" })).toBeEnabled();
  });

  it("supports slider filtering, drag selection and space toggle", async () => {
    const taskId = "task-002";
    const scanResult = createScanResult();

    let statusCallCount = 0;

    createFetchMock([
      ({ url, method }) => {
        if (url.endsWith("/api/tasks/scan/start") && method === "POST") {
          return {
            body: { task_id: taskId, task_type: "scan" },
          };
        }
        return null as never;
      },
      ({ url, method }) => {
        if (url === getStatusUrl(taskId) && method === "GET") {
          statusCallCount += 1;
          if (statusCallCount === 1) {
            return {
              body: createTaskStatus({
                task_id: taskId,
                state: "running",
                progress_percent: 5,
                current_subtask: "准备扫描",
                result: undefined,
              }),
            };
          }

          return {
            body: createTaskStatus({
              task_id: taskId,
              state: "completed",
              progress_percent: 100,
              current_subtask: "扫描完成",
              result: scanResult,
            }),
          };
        }
        return null as never;
      },
    ]);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: startButtonText }));
    await waitFor(() => {
      expect(screen.getByText(/扫描到 3 首/)).toBeInTheDocument();
    });

    const closeTaskButton = screen.getByRole("button", { name: "关闭任务面板" });
    await userEvent.click(closeTaskButton);

    const slider = screen.getByLabelText("最近修改时间") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "1" } });

    await waitFor(() => {
      expect(screen.getByText("当前跨度: 1小时")).toBeInTheDocument();
    });

    expect(screen.getByText("B - Song 2.flac")).toBeInTheDocument();
    expect(screen.queryByText("A - Song 1.mp3")).not.toBeInTheDocument();
    expect(screen.queryByText("C - Song 3.ogg")).not.toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "0" } });
    await waitFor(() => {
      expect(screen.getByText("A - Song 1.mp3")).toBeInTheDocument();
      expect(screen.getByText("C - Song 3.ogg")).toBeInTheDocument();
    });

    const checkboxA = screen.getByRole("checkbox", { name: "选择 A - Song 1.mp3" });
    const checkboxB = screen.getByRole("checkbox", { name: "选择 B - Song 2.flac" });
    const checkboxC = screen.getByRole("checkbox", { name: "选择 C - Song 3.ogg" });

    expect(checkboxA).not.toBeChecked();
    expect(checkboxB).not.toBeChecked();
    expect(checkboxC).not.toBeChecked();

    const rowA = checkboxA.closest("tr");
    const rowB = checkboxB.closest("tr");

    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();

    fireEvent.pointerDown(rowA as HTMLTableRowElement, { button: 0 });
    fireEvent.pointerEnter(rowB as HTMLTableRowElement);
    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(checkboxA).toBeChecked();
      expect(checkboxB).toBeChecked();
    });

    const rowC = checkboxC.closest("tr") as HTMLTableRowElement;
    checkboxC.focus();
    fireEvent.focus(checkboxC);
    expect(checkboxC).toHaveFocus();

    fireEvent.keyDown(rowC.parentElement as HTMLElement, {
      code: "Space",
      key: " ",
      keyCode: 32,
      charCode: 32,
    });

    await waitFor(() => {
      expect(checkboxC).toBeChecked();
    });

    fireEvent.keyDown(rowC.parentElement as HTMLElement, {
      code: "Space",
      key: " ",
      keyCode: 32,
      charCode: 32,
    });

    await waitFor(() => {
      expect(checkboxC).not.toBeChecked();
    });
  });

  it("supports case-sensitive and regex keyword filtering with in-input toggles", async () => {
    const taskId = "task-007";
    const scanResult = createScanResult();

    let statusCallCount = 0;

    createFetchMock([
      ({ url, method }) => {
        if (url.endsWith("/api/tasks/scan/start") && method === "POST") {
          return {
            body: { task_id: taskId, task_type: "scan" },
          };
        }
        return null as never;
      },
      ({ url, method }) => {
        if (url === getStatusUrl(taskId) && method === "GET") {
          statusCallCount += 1;
          if (statusCallCount === 1) {
            return {
              body: createTaskStatus({
                task_id: taskId,
                state: "running",
                progress_percent: 6,
                current_subtask: "准备扫描",
                result: undefined,
              }),
            };
          }

          return {
            body: createTaskStatus({
              task_id: taskId,
              state: "completed",
              progress_percent: 100,
              current_subtask: "扫描完成",
              result: scanResult,
            }),
          };
        }
        return null as never;
      },
    ]);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: startButtonText }));
    await waitFor(() => {
      expect(screen.getByText(/扫描到 3 首/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "关闭任务面板" }));

    const keywordInput = screen.getByPlaceholderText("筛选文件名/歌曲名/艺术家/专辑");
    const caseSensitiveButton = screen.getByRole("button", { name: "大小写敏感筛选" });
    const regexButton = screen.getByRole("button", { name: "正则表达式筛选" });

    await userEvent.clear(keywordInput);
    await userEvent.type(keywordInput, "song 1");
    await waitFor(() => {
      expect(screen.getByText("A - Song 1.mp3")).toBeInTheDocument();
    });

    await userEvent.click(caseSensitiveButton);
    await waitFor(() => {
      expect(screen.queryByText("A - Song 1.mp3")).not.toBeInTheDocument();
      expect(screen.getByText("没有匹配结果")).toBeInTheDocument();
    });

    await userEvent.clear(keywordInput);
    await userEvent.type(keywordInput, "Song\\s+1");
    await waitFor(() => {
      expect(screen.queryByText("A - Song 1.mp3")).not.toBeInTheDocument();
    });

    await userEvent.click(regexButton);
    await waitFor(() => {
      expect(screen.getByText("A - Song 1.mp3")).toBeInTheDocument();
    });

    await userEvent.clear(keywordInput);
    await userEvent.type(keywordInput, "(");
    await waitFor(() => {
      expect(screen.getByText("正则表达式无效")).toBeInTheDocument();
    });
  });

  it("supports metadata sorting columns and only marks active column indicator", async () => {
    const taskId = "task-005";
    const scanResult = createScanResult();

    let statusCallCount = 0;

    createFetchMock([
      ({ url, method }) => {
        if (url.endsWith("/api/tasks/scan/start") && method === "POST") {
          return {
            body: { task_id: taskId, task_type: "scan" },
          };
        }
        return null as never;
      },
      ({ url, method }) => {
        if (url === getStatusUrl(taskId) && method === "GET") {
          statusCallCount += 1;
          if (statusCallCount === 1) {
            return {
              body: createTaskStatus({
                task_id: taskId,
                state: "running",
                progress_percent: 8,
                current_subtask: "准备扫描",
                result: undefined,
              }),
            };
          }

          return {
            body: createTaskStatus({
              task_id: taskId,
              state: "completed",
              progress_percent: 100,
              current_subtask: "扫描完成",
              result: scanResult,
            }),
          };
        }
        return null as never;
      },
    ]);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: startButtonText }));
    await waitFor(() => {
      expect(screen.getByText(/扫描到 3 首/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "关闭任务面板" }));

    const fileNameSortButton = screen.getByRole("button", { name: "文件名" });
    const formatSortButton = screen.getByRole("button", { name: "格式" });
    const sizeSortButton = screen.getByRole("button", { name: "大小" });
    const modifiedAtSortButton = screen.getByRole("button", { name: "修改时间" });
    const durationSortButton = screen.getByRole("button", { name: "时长" });
    const titleSortButton = screen.getByRole("button", { name: "标题" });
    const artistSortButton = screen.getByRole("button", { name: "艺术家" });
    const albumSortButton = screen.getByRole("button", { name: "专辑" });

    expect(fileNameSortButton).toBeInTheDocument();
    expect(formatSortButton).toBeInTheDocument();
    expect(sizeSortButton).toBeInTheDocument();
    expect(modifiedAtSortButton).toBeInTheDocument();
    expect(durationSortButton).toBeInTheDocument();
    expect(titleSortButton).toBeInTheDocument();
    expect(artistSortButton).toBeInTheDocument();
    expect(albumSortButton).toBeInTheDocument();
    expect(modifiedAtSortButton).toHaveClass("is-active");

    await userEvent.click(titleSortButton);
    await userEvent.click(titleSortButton);

    await waitFor(() => {
      expect(titleSortButton).toHaveClass("is-active");
      expect(modifiedAtSortButton).not.toHaveClass("is-active");
    });

    const firstRow = screen.getAllByRole("checkbox")[0]?.closest("tr");
    expect(firstRow).not.toBeNull();
    expect(within(firstRow as HTMLTableRowElement).getByText("C - Song 3.ogg")).toBeInTheDocument();

    await userEvent.click(artistSortButton);
    await userEvent.click(artistSortButton);
    await waitFor(() => {
      expect(artistSortButton).toHaveClass("is-active");
      expect(titleSortButton).not.toHaveClass("is-active");
    });

    await userEvent.click(albumSortButton);
    await userEvent.click(albumSortButton);
    await waitFor(() => {
      expect(albumSortButton).toHaveClass("is-active");
      expect(artistSortButton).not.toHaveClass("is-active");
    });
  });

  it("shows global page scroll shortcuts only when page is scrollable", async () => {
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const originalDocScrollHeight = Object.getOwnPropertyDescriptor(document.documentElement, "scrollHeight");
    const originalBodyScrollHeight = Object.getOwnPropertyDescriptor(document.body, "scrollHeight");

    let viewportHeight = 900;
    let pageHeight = 900;

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      get: () => viewportHeight,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      get: () => pageHeight,
    });
    Object.defineProperty(document.body, "scrollHeight", {
      configurable: true,
      get: () => pageHeight,
    });

    try {
      render(<App />);

      expect(screen.queryByRole("button", { name: "回到顶部" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "滚到底部" })).not.toBeInTheDocument();

      pageHeight = 1600;
      fireEvent(window, new Event("resize"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "回到顶部" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "滚到底部" })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole("button", { name: "回到顶部" }));
      await userEvent.click(screen.getByRole("button", { name: "滚到底部" }));

      expect(scrollSpy).toHaveBeenNthCalledWith(1, {
        top: 0,
        behavior: "smooth",
      });
      expect(scrollSpy).toHaveBeenNthCalledWith(2, {
        top: 1600,
        behavior: "smooth",
      });
    } finally {
      if (originalInnerHeight) {
        Object.defineProperty(window, "innerHeight", originalInnerHeight);
      }
      if (originalDocScrollHeight) {
        Object.defineProperty(document.documentElement, "scrollHeight", originalDocScrollHeight);
      }
      if (originalBodyScrollHeight) {
        Object.defineProperty(document.body, "scrollHeight", originalBodyScrollHeight);
      }
    }
  });

  it("keeps duplicate execute disabled when duplicate scan finds no groups", async () => {
    const taskId = "task-006";
    const scanResult = createScanResult();

    let statusCallCount = 0;

    createFetchMock([
      ({ url, method }) => {
        if (url.endsWith("/api/tasks/scan/start") && method === "POST") {
          return {
            body: { task_id: taskId, task_type: "scan" },
          };
        }
        return null as never;
      },
      ({ url, method }) => {
        if (url === getStatusUrl(taskId) && method === "GET") {
          statusCallCount += 1;
          if (statusCallCount === 1) {
            return {
              body: createTaskStatus({
                task_id: taskId,
                state: "running",
                progress_percent: 12,
                current_subtask: "准备扫描",
                result: undefined,
              }),
            };
          }

          return {
            body: createTaskStatus({
              task_id: taskId,
              state: "completed",
              progress_percent: 100,
              current_subtask: "扫描完成",
              result: scanResult,
            }),
          };
        }
        return null as never;
      },
      ({ url, method, body }) => {
        if (url.endsWith("/api/duplicates/scan") && method === "POST") {
          return {
            body: {
              directory: String(body.directory ?? scanResult.directory),
              groups: [],
              ignored_files: [],
            },
          };
        }
        return null as never;
      },
    ]);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: startButtonText }));
    await waitFor(() => {
      expect(screen.getByText(/扫描到 3 首/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "关闭任务面板" }));

    await userEvent.click(screen.getByRole("button", { name: "扫描重复组" }));

    await waitFor(() => {
      expect(screen.getByText("当前没有重复组。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "执行去重决策" })).toBeDisabled();
    });
  });

  it("supports metadata-based rename preview warnings and disables execute when plan is empty", async () => {
    const taskId = "task-003";
    const scanResult = createScanResult();

    let statusCallCount = 0;
    let previewBody: Record<string, unknown> | null = null;

    createFetchMock([
      ({ url, method }) => {
        if (url.endsWith("/api/tasks/scan/start") && method === "POST") {
          return {
            body: { task_id: taskId, task_type: "scan" },
          };
        }
        return null as never;
      },
      ({ url, method }) => {
        if (url === getStatusUrl(taskId) && method === "GET") {
          statusCallCount += 1;
          if (statusCallCount === 1) {
            return {
              body: createTaskStatus({
                task_id: taskId,
                state: "running",
                progress_percent: 30,
                current_subtask: "准备扫描",
                result: undefined,
              }),
            };
          }

          return {
            body: createTaskStatus({
              task_id: taskId,
              state: "completed",
              progress_percent: 100,
              current_subtask: "扫描完成",
              result: scanResult,
            }),
          };
        }
        return null as never;
      },
      ({ url, method, body }) => {
        if (url.endsWith("/api/operations/preview") && method === "POST") {
          previewBody = body;
          return {
            body: {
              operation: "rename_from_metadata",
              directory: scanResult.directory,
              items: [],
              warnings: [
                {
                  file_name: "B - Song 2.flac",
                  reason: "缺少必要元数据: artist(艺术家)",
                },
              ],
              has_conflict: false,
              conflict_count: 0,
            },
          };
        }
        return null as never;
      },
    ]);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: startButtonText }));
    await waitFor(() => {
      expect(screen.getByText(/扫描到 3 首/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "关闭任务面板" }));

    await userEvent.click(screen.getByRole("button", { name: "全选" }));

    await userEvent.selectOptions(screen.getByLabelText("操作类型"), "rename_from_metadata");
    await userEvent.selectOptions(screen.getByLabelText("重命名模式"), "title_artist");

    await userEvent.click(screen.getByRole("button", { name: "生成变更清单" }));

    await waitFor(() => {
      expect(screen.getByText("警告与跳过 1 项（未加入清单）")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "执行当前清单" })).toBeDisabled();
    });

    expect(previewBody).toMatchObject({
      operation: "rename_from_metadata",
      fill_mode: "title_artist",
    });
  });

  it("builds payload for fix-extension, special-char map and split metadata cleanup operations", async () => {
    const taskId = "task-008";
    const scanResult = createScanResult();

    let statusCallCount = 0;
    const previewBodies: Record<string, unknown>[] = [];

    createFetchMock([
      ({ url, method }) => {
        if (url.endsWith("/api/tasks/scan/start") && method === "POST") {
          return {
            body: { task_id: taskId, task_type: "scan" },
          };
        }
        return null as never;
      },
      ({ url, method }) => {
        if (url === getStatusUrl(taskId) && method === "GET") {
          statusCallCount += 1;
          if (statusCallCount === 1) {
            return {
              body: createTaskStatus({
                task_id: taskId,
                state: "running",
                progress_percent: 15,
                current_subtask: "准备扫描",
                result: undefined,
              }),
            };
          }

          return {
            body: createTaskStatus({
              task_id: taskId,
              state: "completed",
              progress_percent: 100,
              current_subtask: "扫描完成",
              result: scanResult,
            }),
          };
        }
        return null as never;
      },
      ({ url, method, body }) => {
        if (url.endsWith("/api/operations/preview") && method === "POST") {
          previewBodies.push(body);
          return {
            body: {
              operation: String(body.operation ?? "swap_name_parts"),
              directory: scanResult.directory,
              items: [],
              warnings: [],
              has_conflict: false,
              conflict_count: 0,
            },
          };
        }
        return null as never;
      },
    ]);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: startButtonText }));
    await waitFor(() => {
      expect(screen.getByText(/扫描到 3 首/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "关闭任务面板" }));
    await userEvent.click(screen.getByRole("button", { name: "全选" }));

    await userEvent.selectOptions(screen.getByLabelText("操作类型"), "fix_extension_by_format");
    await userEvent.click(screen.getByRole("button", { name: "生成变更清单" }));

    await waitFor(() => {
      expect(previewBodies.length).toBe(1);
    });
    expect(previewBodies[0]).toMatchObject({
      operation: "fix_extension_by_format",
    });

    await userEvent.selectOptions(screen.getByLabelText("操作类型"), "special_char_replace");
    await userEvent.type(screen.getByLabelText("映射 1 的源字符"), "&");
    await userEvent.type(screen.getByLabelText("映射 1 的目标字符"), "、");
    await userEvent.click(screen.getByRole("button", { name: "生成变更清单" }));

    await waitFor(() => {
      expect(previewBodies.length).toBe(2);
    });
    expect(previewBodies[1]).toMatchObject({
      operation: "special_char_replace",
      special_char_map: { "&": "、" },
    });

    await userEvent.selectOptions(screen.getByLabelText("操作类型"), "metadata_cleanup_text");
    await userEvent.clear(screen.getByLabelText("清理文本或正则"));
    await userEvent.type(screen.getByLabelText("清理文本或正则"), "feat\\.");
    await userEvent.click(screen.getByLabelText("使用正则"));
    await userEvent.click(screen.getByLabelText("大小写敏感"));
    await userEvent.click(screen.getByRole("button", { name: "生成变更清单" }));

    await waitFor(() => {
      expect(previewBodies.length).toBe(3);
    });
    expect(previewBodies[2]).toMatchObject({
      operation: "metadata_cleanup_text",
      cleanup_pattern: "feat\\.",
      cleanup_use_regex: true,
      cleanup_case_sensitive: true,
      cleanup_fields: ["title", "artist", "album"],
    });

    await userEvent.selectOptions(screen.getByLabelText("操作类型"), "metadata_cleanup_remove_fields");
    await userEvent.type(screen.getByLabelText("删除字段（逗号分隔）"), "album,comment");
    await userEvent.click(screen.getByRole("button", { name: "生成变更清单" }));

    await waitFor(() => {
      expect(previewBodies.length).toBe(4);
    });
    expect(previewBodies[3]).toMatchObject({
      operation: "metadata_cleanup_remove_fields",
      remove_fields: ["album", "comment"],
    });
  });

  it("clears operation preview when generating with no selected files", async () => {
    const taskId = "task-004";
    const scanResult = createScanResult();

    let statusCallCount = 0;
    let previewCallCount = 0;

    createFetchMock([
      ({ url, method }) => {
        if (url.endsWith("/api/tasks/scan/start") && method === "POST") {
          return {
            body: { task_id: taskId, task_type: "scan" },
          };
        }
        return null as never;
      },
      ({ url, method }) => {
        if (url === getStatusUrl(taskId) && method === "GET") {
          statusCallCount += 1;
          if (statusCallCount === 1) {
            return {
              body: createTaskStatus({
                task_id: taskId,
                state: "running",
                progress_percent: 20,
                current_subtask: "准备扫描",
                result: undefined,
              }),
            };
          }

          return {
            body: createTaskStatus({
              task_id: taskId,
              state: "completed",
              progress_percent: 100,
              current_subtask: "扫描完成",
              result: scanResult,
            }),
          };
        }
        return null as never;
      },
      ({ url, method }) => {
        if (url.endsWith("/api/operations/preview") && method === "POST") {
          previewCallCount += 1;
          return {
            body: {
              operation: "swap_name_parts",
              directory: scanResult.directory,
              items: [
                {
                  id: "item-0001",
                  action: "rename",
                  target_type: "music",
                  source_file: "A - Song 1.mp3",
                  destination_file: "Song 1 - A.mp3",
                  metadata_changes: [],
                  reason: "A-B 与 B-A 互换",
                  conflict: false,
                  conflict_reason: null,
                },
              ],
              warnings: [],
              has_conflict: false,
              conflict_count: 0,
            },
          };
        }
        return null as never;
      },
    ]);

    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: startButtonText }));
    await waitFor(() => {
      expect(screen.getByText(/扫描到 3 首/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "关闭任务面板" }));

    await userEvent.click(screen.getByRole("button", { name: "全选" }));
    await userEvent.click(screen.getByRole("button", { name: "生成变更清单" }));

    await waitFor(() => {
      expect(previewCallCount).toBe(1);
      expect(screen.getByText("预览结果")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "执行当前清单" })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole("button", { name: "全部取消选择" }));
    await userEvent.click(screen.getByRole("button", { name: "生成变更清单" }));

    await waitFor(() => {
      expect(previewCallCount).toBe(1);
      expect(screen.queryByText("预览结果")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "执行当前清单" })).toBeDisabled();
      expect(screen.getByText("请先选择至少一个文件。")).toBeInTheDocument();
    });
  });
});
