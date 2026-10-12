const mockAuthenticatedApiFetch = jest.fn();

jest.mock("../api/auth", () => ({
  authenticatedApiFetch: (...args: unknown[]) =>
    mockAuthenticatedApiFetch(...args),
}));

// Imports follow the mock so the stream client uses the controlled API request.
// eslint-disable-next-line import/first
import {
  connectAuthenticatedSse,
  type AuthenticatedSseHandlers,
} from "./authenticatedSse";

const flushMicrotasks = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

const openResponse = (body: ReadableStream<Uint8Array>) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });

const emptyHandlers = (): AuthenticatedSseHandlers => ({
  onOpen: jest.fn(),
  onMessage: jest.fn(),
  onError: jest.fn(),
});

describe("connectAuthenticatedSse", () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockAuthenticatedApiFetch.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("opens with event-stream headers and dispatches messages across chunks", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": keep-alive\n\ndata: {\"type\":\"connected\","));
        controller.enqueue(encoder.encode("\"churchId\":\"church-1\"}\n\n"));
        controller.close();
      },
    });
    mockAuthenticatedApiFetch.mockResolvedValue(openResponse(body));
    const handlers = emptyHandlers();

    const close = connectAuthenticatedSse(
      "api/churches/church-1/teams/stream",
      handlers,
    );
    await flushMicrotasks();

    expect(mockAuthenticatedApiFetch).toHaveBeenCalledWith(
      "api/churches/church-1/teams/stream",
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onMessage).toHaveBeenCalledWith(
      '{"type":"connected","churchId":"church-1"}',
    );
    close();
  });

  it.each([
    [401, "authentication"],
    [403, "permission"],
  ] as const)(
    "stops retrying after %i %s responses",
    async (status, kind) => {
      jest.useFakeTimers();
      mockAuthenticatedApiFetch.mockResolvedValue(
        new Response("denied", { status }),
      );
      const handlers = emptyHandlers();

      connectAuthenticatedSse("api/churches/church-1/restream/stream", handlers);
      await flushMicrotasks();

      expect(handlers.onError).toHaveBeenCalledWith({ kind, status });
      await jest.advanceTimersByTimeAsync(60000);
      expect(mockAuthenticatedApiFetch).toHaveBeenCalledTimes(1);
    },
  );

  it("retries temporary server failures with a delay", async () => {
    jest.useFakeTimers();
    mockAuthenticatedApiFetch
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        openResponse(new ReadableStream<Uint8Array>({ start() {} })),
      );
    const handlers = emptyHandlers();
    const close = connectAuthenticatedSse(
      "api/churches/church-1/restream/stream",
      handlers,
    );
    await flushMicrotasks();

    expect(handlers.onError).toHaveBeenCalledWith({
      kind: "http",
      status: 503,
      retryable: true,
    });
    expect(mockAuthenticatedApiFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(499);
    expect(mockAuthenticatedApiFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(mockAuthenticatedApiFetch).toHaveBeenCalledTimes(2);
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);

    close();
  });

  it("retries network interruptions and aborts the active request on cleanup", async () => {
    jest.useFakeTimers();
    mockAuthenticatedApiFetch
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockImplementationOnce((_path: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      );
    const handlers = emptyHandlers();
    const close = connectAuthenticatedSse(
      "api/churches/church-1/teams/stream",
      handlers,
    );
    await flushMicrotasks();
    expect(handlers.onError).toHaveBeenCalledWith({ kind: "network" });

    await jest.advanceTimersByTimeAsync(500);
    expect(mockAuthenticatedApiFetch).toHaveBeenCalledTimes(2);
    const [, options] = mockAuthenticatedApiFetch.mock.calls[1];
    close();
    expect(options.signal.aborted).toBe(true);
    await flushMicrotasks();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
  });
});
