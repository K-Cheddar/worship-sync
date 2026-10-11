import React from "react";
import { act, renderHook } from "@testing-library/react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { createMockGlobalContext } from "../../../test/mocks";
import type { AuthenticatedSseHandlers } from "../../../utils/authenticatedSse";
import { useTeamsLiveSync } from "./useTeamsLiveSync";

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

jest.mock("../../../utils/authenticatedSse", () => ({
  connectAuthenticatedSse: (...args: unknown[]) =>
    mockConnectAuthenticatedSse(...(args as [string, AuthenticatedSseHandlers])),
}));

const createWrapper = (
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

describe("useTeamsLiveSync", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    mockConnectAuthenticatedSse.mockClear();
  });

  it("opens an authenticated church-scoped stream and forwards events", () => {
    const onMessage = jest.fn();
    const { result } = renderHook(
      () => useTeamsLiveSync("church-1", onMessage),
    );

    expect(mockConnections).toHaveLength(1);
    expect(mockConnections[0].path).toBe(
      "api/churches/church-1/teams/stream",
    );
    expect(result.current.connectionState).toBe("connecting");
    expect(result.current.reconnectVersion).toBe(0);

    const event = {
      type: "schedule-updated",
      schedule: { scheduleId: "s1" },
    };
    act(() => mockConnections[0].handlers.onMessage(JSON.stringify(event)));
    expect(onMessage).toHaveBeenCalledWith(event);
  });

  it("reports the initial open without counting it as a reconnect", () => {
    const { result } = renderHook(() =>
      useTeamsLiveSync("church-1", jest.fn()),
    );

    act(() => mockConnections[0].handlers.onOpen());
    expect(result.current.connectionState).toBe("connected");
    expect(result.current.reconnectVersion).toBe(0);
  });

  it("increments reconnectVersion once after each interruption and recovery", () => {
    const { result } = renderHook(() =>
      useTeamsLiveSync("church-1", jest.fn()),
    );
    const handlers = mockConnections[0].handlers;

    act(() => handlers.onOpen());
    act(() => {
      handlers.onError({ kind: "interrupted" });
      handlers.onError({ kind: "interrupted" });
    });
    expect(result.current.connectionState).toBe("disconnected");
    act(() => {
      handlers.onOpen();
      handlers.onOpen();
    });
    expect(result.current.connectionState).toBe("connected");
    expect(result.current.reconnectVersion).toBe(1);

    act(() => handlers.onError({ kind: "interrupted" }));
    act(() => handlers.onOpen());
    expect(result.current.reconnectVersion).toBe(2);
  });

  it.each([
    [{ kind: "authentication", status: 401 } as const, "authentication"],
    [{ kind: "permission", status: 403 } as const, "permission"],
  ])("stops in unavailable state for distinct auth failures", (failure, kind) => {
    const { result } = renderHook(() =>
      useTeamsLiveSync("church-1", jest.fn()),
    );

    act(() => mockConnections[0].handlers.onError(failure));
    expect(result.current.connectionState).toBe("unavailable");
    expect(result.current.connectionFailure).toBe(kind);
  });

  it("keeps retryable server failures in the disconnected state", () => {
    const { result } = renderHook(() =>
      useTeamsLiveSync("church-1", jest.fn()),
    );

    act(() =>
      mockConnections[0].handlers.onError({
        kind: "http",
        status: 503,
        retryable: true,
      }),
    );
    expect(result.current.connectionState).toBe("disconnected");
    expect(result.current.connectionFailure).toBe("http");
  });

  it("does not open a stream without a churchId", () => {
    const { result } = renderHook(() => useTeamsLiveSync(null, jest.fn()));
    expect(mockConnections).toHaveLength(0);
    expect(result.current.connectionState).toBe("unavailable");
  });

  it("replaces the stream when the church changes", () => {
    const { rerender } = renderHook(
      ({ churchId }: { churchId: string }) =>
        useTeamsLiveSync(churchId, jest.fn()),
      { initialProps: { churchId: "church-1" } },
    );
    const first = mockConnections[0];

    rerender({ churchId: "church-2" });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(mockConnections).toHaveLength(2);
    expect(mockConnections[1].path).toContain("church-2");
  });

  it("replaces the stream when the authenticated identity changes", () => {
    let context = createMockGlobalContext({ churchId: "church-1" });
    const { rerender } = renderHook(
      () => useTeamsLiveSync("church-1", jest.fn()),
      { wrapper: createWrapper(() => context) },
    );
    const first = mockConnections[0];

    context = {
      ...context,
      userId: "different-human",
    };
    rerender();

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(mockConnections).toHaveLength(2);
  });

  it("closes the stream on unmount", () => {
    const { unmount } = renderHook(() =>
      useTeamsLiveSync("church-1", jest.fn()),
    );
    const connection = mockConnections[0];

    unmount();
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown event when the payload is not valid JSON", () => {
    const onMessage = jest.fn();
    renderHook(() => useTeamsLiveSync("church-1", onMessage));

    act(() => mockConnections[0].handlers.onMessage("not json"));
    expect(onMessage).toHaveBeenCalledWith({ type: "unknown" });
  });
});
