import React from "react";
import { act, renderHook } from "@testing-library/react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockGlobalContext } from "../../test/mocks";
import type { AuthenticatedSseHandlers } from "../../utils/authenticatedSse";
import { useServicePlanLiveSync } from "./useServicePlanLiveSync";

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

jest.mock("../../utils/authenticatedSse", () => ({
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

describe("useServicePlanLiveSync", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    mockConnectAuthenticatedSse.mockClear();
  });

  it("opens the Services stream and forwards plan invalidations", () => {
    const onMessage = jest.fn();
    const { result } = renderHook(() =>
      useServicePlanLiveSync("church-1", onMessage, true),
    );

    expect(mockConnections).toHaveLength(1);
    expect(mockConnections[0].path).toBe(
      "api/churches/church-1/services/stream",
    );
    expect(result.current.connectionState).toBe("connecting");

    const event = {
      type: "service-plan-updated",
      churchId: "church-1",
      planKey: "sunday@2026-11-01",
    };
    act(() => mockConnections[0].handlers.onMessage(JSON.stringify(event)));
    expect(onMessage).toHaveBeenCalledWith(event);
  });

  it.each([
    [{ kind: "permission", status: 403 } as const, "unavailable", "permission"],
    [{ kind: "network" } as const, "disconnected", "network"],
  ])("classifies %s stream failure as %s", (failure, state, kind) => {
    const { result } = renderHook(() =>
      useServicePlanLiveSync("church-1", jest.fn(), true),
    );

    act(() => mockConnections[0].handlers.onError(failure));
    expect(result.current.connectionState).toBe(state);
    expect(result.current.connectionFailure).toBe(kind);
  });

  it("does not connect without Services view access", () => {
    const { result } = renderHook(() =>
      useServicePlanLiveSync("church-1", jest.fn(), false),
    );

    expect(mockConnections).toHaveLength(0);
    expect(result.current.connectionState).toBe("unavailable");
  });

  it("replaces the stream when church or authenticated identity changes", () => {
    let context = createMockGlobalContext({ churchId: "church-1" });
    const { rerender } = renderHook(
      ({ churchId }: { churchId: string }) =>
        useServicePlanLiveSync(churchId, jest.fn(), true),
      {
        initialProps: { churchId: "church-1" },
        wrapper: createWrapper(() => context),
      },
    );
    const first = mockConnections[0];

    context = { ...context, userId: "different-human" };
    rerender({ churchId: "church-2" });

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(mockConnections).toHaveLength(2);
    expect(mockConnections[1].path).toContain("church-2");
  });

  it("ignores queued stream callbacks after unmount", () => {
    const onMessage = jest.fn();
    const { unmount } = renderHook(() =>
      useServicePlanLiveSync("church-1", onMessage, true),
    );
    const connection = mockConnections[0];

    unmount();
    act(() => {
      connection.handlers.onMessage(JSON.stringify({ type: "connected" }));
      connection.handlers.onOpen();
    });

    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalled();
  });
});
