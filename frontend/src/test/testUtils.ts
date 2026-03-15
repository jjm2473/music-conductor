import { vi } from "vitest";

type JsonBody = Record<string, unknown>;

type HandlerContext = {
  url: string;
  method: string;
  body: JsonBody;
};

type HandlerResult = {
  ok?: boolean;
  status?: number;
  body?: unknown;
};

type Handler = (context: HandlerContext) => HandlerResult | Promise<HandlerResult>;

type EventHandler = (event: MessageEvent<string>) => void;

type ListenerMap = Map<string, EventHandler[]>;

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  private readonly listeners: ListenerMap;
  closed: boolean;

  constructor(url: string) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (typeof listener !== "function") {
      return;
    }
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(listener as EventHandler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (typeof listener !== "function") {
      return;
    }
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      handlers.filter((handler) => handler !== listener)
    );
  }

  emit(type: string, payload: unknown) {
    const handlers = this.listeners.get(type) ?? [];
    const event = { data: JSON.stringify(payload) } as MessageEvent<string>;
    handlers.forEach((handler) => handler(event));
  }

  close() {
    this.closed = true;
  }

  static latest() {
    const count = MockEventSource.instances.length;
    if (count === 0) {
      return null;
    }
    return MockEventSource.instances[count - 1] ?? null;
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return body;
  },
}) as Response;

export const installEventSourceMock = () => {
  MockEventSource.reset();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
};

export const getLatestEventSource = () => MockEventSource.latest();

export const createFetchMock = (handlers: Handler[]) => {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as JsonBody) : {};

    for (const handler of handlers) {
      const result = await handler({ url, method, body });
      if (result) {
        return jsonResponse(result.status ?? (result.ok === false ? 400 : 200), result.body ?? {});
      }
    }

    return jsonResponse(404, { detail: `No mocked handler for ${method} ${url}` });
  });

  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
};

const now = Date.now();

export const createScanResult = (directory = "/tmp/music") => {
  const files = [
    {
      id: "1",
      file_name: "A - Song 1.mp3",
      absolute_path: `${directory}/A - Song 1.mp3`,
      extension: "mp3",
      size_bytes: 1024,
      modified_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      duration_seconds: 181,
      metadata: { title: "Song 1", artist: "A", album: "Alpha" },
    },
    {
      id: "2",
      file_name: "B - Song 2.flac",
      absolute_path: `${directory}/B - Song 2.flac`,
      extension: "flac",
      size_bytes: 2048,
      modified_at: new Date(now - 30 * 60 * 1000).toISOString(),
      duration_seconds: 210,
      metadata: { title: "Song 2", artist: "B", album: "Beta" },
    },
    {
      id: "3",
      file_name: "C - Song 3.ogg",
      absolute_path: `${directory}/C - Song 3.ogg`,
      extension: "ogg",
      size_bytes: 4096,
      modified_at: new Date(now - 420 * 24 * 60 * 60 * 1000).toISOString(),
      duration_seconds: 240,
      metadata: { title: "Song 3", artist: "C", album: "Gamma" },
    },
  ];

  return {
    directory,
    files,
    skipped: [],
    total_files: files.length,
  };
};

export const createTaskStatus = (overrides?: Partial<Record<string, unknown>>) => ({
  task_id: "task-scan-1",
  task_type: "scan",
  state: "completed",
  progress_percent: 100,
  current_subtask: "扫描完成",
  started_at: "2026-03-15T12:00:00.000Z",
  finished_at: "2026-03-15T12:00:01.000Z",
  failed: [],
  result: createScanResult(),
  ...overrides,
});
