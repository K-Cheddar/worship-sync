import { authenticatedApiFetch } from "../api/auth";

export type AuthenticatedSseFailure =
  | { kind: "authentication"; status: 401 }
  | { kind: "permission"; status: 403 }
  | { kind: "http"; status: number; retryable: boolean }
  | { kind: "network" }
  | { kind: "interrupted" }
  | { kind: "invalid-response" };

export type AuthenticatedSseHandlers = {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onError: (failure: AuthenticatedSseFailure) => void;
};

const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 30000;
const STABLE_CONNECTION_MS = 30000;

const isRetryableStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const parseEventStream = async (
  response: Response,
  onMessage: (data: string) => void,
) => {
  if (!response.body) throw new Error("SSE response has no readable body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    onMessage(data);
  };

  const processLine = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    if (!line.startsWith("data:")) return;
    const value = line.slice(5);
    dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    // SSE permits LF, CRLF, and CR line endings. The server currently emits
    // LF, while normalizing here also handles chunk boundaries in CRLF input.
    buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(processLine);

    if (done) {
      if (buffer) processLine(buffer);
      break;
    }
  }
};

/**
 * Opens an authenticated server-sent event stream. Fetch preserves cookie
 * credentials in browsers and allows packaged Electron to use the same bearer
 * and workstation headers as ordinary authenticated API requests.
 */
export const connectAuthenticatedSse = (
  path: string,
  handlers: AuthenticatedSseHandlers,
) => {
  let disposed = false;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let activeController: AbortController | undefined;

  const scheduleRetry = () => {
    if (disposed) return;
    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      INITIAL_RETRY_DELAY_MS * 2 ** Math.min(retryCount, 6),
    );
    retryCount += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, delay);
  };

  const connect = async () => {
    if (disposed) return;
    const controller = new AbortController();
    activeController = controller;

    let response: Response;
    try {
      response = await authenticatedApiFetch(path, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
    } catch {
      if (disposed || controller.signal.aborted) return;
      handlers.onError({ kind: "network" });
      scheduleRetry();
      return;
    }

    if (disposed || controller.signal.aborted) return;

    if (!response.ok) {
      let failure: AuthenticatedSseFailure;
      if (response.status === 401) {
        failure = { kind: "authentication", status: 401 };
      } else if (response.status === 403) {
        failure = { kind: "permission", status: 403 };
      } else {
        failure = {
          kind: "http",
          status: response.status,
          retryable: isRetryableStatus(response.status),
        };
      }
      handlers.onError(failure);
      if (failure.kind === "http" && failure.retryable) scheduleRetry();
      void response.body?.cancel().catch(() => {});
      return;
    }

    if (
      !response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      handlers.onError({ kind: "invalid-response" });
      void response.body?.cancel().catch(() => {});
      return;
    }

    const openedAt = Date.now();
    handlers.onOpen();

    try {
      await parseEventStream(response, handlers.onMessage);
      if (disposed || controller.signal.aborted) return;
      if (Date.now() - openedAt >= STABLE_CONNECTION_MS) retryCount = 0;
      handlers.onError({ kind: "interrupted" });
      scheduleRetry();
    } catch {
      if (disposed || controller.signal.aborted) return;
      if (Date.now() - openedAt >= STABLE_CONNECTION_MS) retryCount = 0;
      handlers.onError({ kind: "interrupted" });
      scheduleRetry();
    }
  };

  void connect();

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    activeController?.abort();
  };
};
