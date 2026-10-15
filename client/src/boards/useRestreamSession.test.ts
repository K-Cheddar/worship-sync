import React from "react";
import { act, renderHook } from "@testing-library/react";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";
import type { AuthenticatedSseHandlers } from "../utils/authenticatedSse";
import type { RestreamMessage, RestreamSession } from "../types";
import { useRestreamSession } from "./useRestreamSession";

const mockGetRestreamMessages = jest.fn();
const mockGetRestreamSessionStatus = jest.fn();
const mockConnections: Array<{
  path: string;
  handlers: AuthenticatedSseHandlers;
  close: jest.Mock;
}> = [];

const mockConnectAuthenticatedSse = jest.fn(
  (path: string, handlers: AuthenticatedSseHandlers) => {
    const close = jest.fn();
    mockConnections.push({ path, handlers, close });
    return close;
  },
);

jest.mock("./api", () => ({
  getRestreamMessages: (...args: unknown[]) => mockGetRestreamMessages(...args),
  getRestreamSessionStatus: (...args: unknown[]) =>
    mockGetRestreamSessionStatus(...args),
}));

jest.mock("../utils/authenticatedSse", () => ({
  connectAuthenticatedSse: (...args: unknown[]) =>
    mockConnectAuthenticatedSse(...(args as [string, AuthenticatedSseHandlers])),
}));

const session = {
  enabled: true,
  connected: true,
} as RestreamSession;

const message = (id: string) =>
  ({ id, text: `message ${id}`, highlighted: true } as unknown as RestreamMessage);

const wrapperFor = (
  getContext: () => ReturnType<typeof createMockGlobalContext>,
) =>
  ({ children }: React.PropsWithChildren) =>
    React.createElement(
      GlobalInfoContext.Provider,
      {
        value: getContext() as React.ContextType<typeof GlobalInfoContext>,
      },
      children,
    );

const flushMicrotasks = async () => {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
};

describe("useRestreamSession", () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockConnections.length = 0;
    mockConnectAuthenticatedSse.mockClear();
    mockGetRestreamMessages.mockReset();
    mockGetRestreamSessionStatus.mockReset();
    mockGetRestreamMessages.mockResolvedValue({ messages: [message("m1")] });
    mockGetRestreamSessionStatus.mockResolvedValue({
      session,
      bestEffortOnly: false,
      oauthConfigured: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reconciles immediately after initial connection and every reconnection", async () => {
    const { result, unmount } = renderHook(() =>
      useRestreamSession("church-1"),
    );
    await flushMicrotasks();
    expect(result.current.messages).toEqual([message("m1")]);
    expect(mockConnections).toHaveLength(1);
    expect(mockConnections[0].path).toBe(
      "api/churches/church-1/restream/stream",
    );

    act(() => mockConnections[0].handlers.onOpen());
    await flushMicrotasks();
    expect(result.current.streamState).toBe("connected");
    expect(mockGetRestreamSessionStatus).toHaveBeenCalledTimes(2);
    expect(mockGetRestreamMessages).toHaveBeenCalledTimes(2);

    act(() => mockConnections[0].handlers.onError({ kind: "interrupted" }));
    expect(result.current.streamState).toBe("disconnected");
    act(() => mockConnections[0].handlers.onOpen());
    await flushMicrotasks();

    expect(result.current.streamState).toBe("connected");
    expect(mockGetRestreamSessionStatus).toHaveBeenCalledTimes(3);
    expect(mockGetRestreamMessages).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("refreshes known message events and ignores unrelated event types", async () => {
    renderHook(() => useRestreamSession("church-1"));
    await flushMicrotasks();
    const handlers = mockConnections[0].handlers;

    act(() => handlers.onMessage(JSON.stringify({ type: "connected" })));
    await flushMicrotasks();
    expect(mockGetRestreamMessages).toHaveBeenCalledTimes(1);

    act(() => handlers.onMessage(JSON.stringify({ type: "message-updated" })));
    await flushMicrotasks();
    expect(mockGetRestreamMessages).toHaveBeenCalledTimes(2);

    act(() => handlers.onMessage("not json"));
    await flushMicrotasks();
    expect(mockGetRestreamMessages).toHaveBeenCalledTimes(3);
  });

  it("reports status refreshes without treating the existing snapshot as settled", async () => {
    const { result } = renderHook(() => useRestreamSession("church-1"));
    await flushMicrotasks();
    let resolveStatusRefresh:
      | ((value: { session: RestreamSession }) => void)
      | undefined;
    mockGetRestreamSessionStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatusRefresh = resolve;
        }),
    );

    act(() => mockConnections[0].handlers.onMessage(JSON.stringify({ type: "status-updated" })));
    expect(result.current.isRefreshing).toBe(true);
    await act(async () => {
      resolveStatusRefresh?.({ session });
      await Promise.resolve();
    });
    await flushMicrotasks();
    expect(result.current.isRefreshing).toBe(false);
  });

  it("distinguishes authentication from permission failures without retrying in the hook", () => {
    const { result } = renderHook(() => useRestreamSession("church-1"));
    const handlers = mockConnections[0].handlers;

    act(() =>
      handlers.onError({ kind: "authentication", status: 401 }),
    );
    expect(result.current.streamState).toBe("unavailable");
    expect(result.current.streamFailure).toBe("authentication");

    act(() => handlers.onError({ kind: "permission", status: 403 }));
    expect(result.current.streamState).toBe("unavailable");
    expect(result.current.streamFailure).toBe("permission");
  });

  it("keeps retryable server failures disconnected for transport recovery", () => {
    const { result } = renderHook(() => useRestreamSession("church-1"));

    act(() =>
      mockConnections[0].handlers.onError({
        kind: "http",
        status: 503,
        retryable: true,
      }),
    );
    expect(result.current.streamState).toBe("disconnected");
    expect(result.current.streamFailure).toBe("http");
  });

  it("closes and recreates the stream when church or auth identity changes", async () => {
    let context = createMockGlobalContext({ churchId: "church-1" });
    const { rerender, unmount } = renderHook(
      ({ churchId }: { churchId: string }) => useRestreamSession(churchId),
      {
        initialProps: { churchId: "church-1" },
        wrapper: wrapperFor(() => context),
      },
    );
    const first = mockConnections[0];

    rerender({ churchId: "church-2" });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(mockConnections).toHaveLength(2);
    expect(mockConnections[1].path).toContain("church-2");

    const second = mockConnections[1];
    context = { ...context, userId: "another-human" };
    rerender({ churchId: "church-2" });
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(mockConnections).toHaveLength(3);

    const third = mockConnections[2];
    unmount();
    expect(third.close).toHaveBeenCalledTimes(1);
  });

  it("coalesces message events during a refresh and still applies the latest snapshot", async () => {
    const { result, unmount } = renderHook(() =>
      useRestreamSession("church-1"),
    );
    await flushMicrotasks();

    let resolveStatus!: (value: unknown) => void;
    let resolveMessages!: (value: unknown) => void;
    mockGetRestreamSessionStatus.mockImplementationOnce(
      () => new Promise((resolve) => { resolveStatus = resolve; }),
    );
    mockGetRestreamMessages.mockImplementationOnce(
      () => new Promise((resolve) => { resolveMessages = resolve; }),
    );

    act(() =>
      mockConnections[0].handlers.onMessage(
        JSON.stringify({ type: "message-updated" }),
      ),
    );
    act(() =>
      mockConnections[0].handlers.onMessage(
        JSON.stringify({ type: "message-updated" }),
      ),
    );
    act(() =>
      mockConnections[0].handlers.onMessage(
        JSON.stringify({ type: "message-created" }),
      ),
    );
    expect(mockGetRestreamSessionStatus).toHaveBeenCalledTimes(2);
    expect(mockGetRestreamMessages).toHaveBeenCalledTimes(2);

    mockGetRestreamSessionStatus.mockResolvedValue({
      session,
      bestEffortOnly: false,
      oauthConfigured: true,
    });
    mockGetRestreamMessages.mockResolvedValue({ messages: [message("latest")] });
    await act(async () => {
      resolveStatus({
        session,
        bestEffortOnly: false,
        oauthConfigured: true,
      });
      resolveMessages({ messages: [message("intermediate")] });
      await Promise.resolve();
    });
    await flushMicrotasks();

    expect(mockGetRestreamSessionStatus).toHaveBeenCalledTimes(3);
    expect(mockGetRestreamMessages).toHaveBeenCalledTimes(3);
    expect(result.current.messages).toEqual([message("latest")]);
    unmount();
  });

  it("keeps the 60-second fallback refresh", async () => {
    jest.useFakeTimers();
    const { unmount } = renderHook(() => useRestreamSession("church-1"));
    await flushMicrotasks();

    act(() => jest.advanceTimersByTime(60000));
    await flushMicrotasks();
    expect(mockGetRestreamSessionStatus).toHaveBeenCalledTimes(2);
    expect(mockGetRestreamMessages).toHaveBeenCalledTimes(2);
    unmount();
  });
});
