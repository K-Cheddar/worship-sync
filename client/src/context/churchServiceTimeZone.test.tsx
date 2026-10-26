import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChurchServiceTimeZoneGate from "../pages/Teams/components/ChurchServiceTimeZoneGate";
import type { PropsWithChildren } from "react";
import { AuthApiError, getChurchServiceTimeZone } from "../api/auth";
import { setDisplayToken } from "../utils/authStorage";
import {
  connectAuthenticatedSse,
  type AuthenticatedSseHandlers,
} from "../utils/authenticatedSse";
import { createMockGlobalContext } from "../test/mocks";
import { GlobalInfoContext } from "./globalInfo";
import {
  ChurchServiceTimeZoneProvider,
  useChurchServiceTimeZone,
} from "./churchServiceTimeZone";

jest.mock("../api/auth", () => ({
  ...jest.requireActual("../api/auth"),
  getChurchServiceTimeZone: jest.fn(),
}));
jest.mock("../utils/authenticatedSse", () => ({
  connectAuthenticatedSse: jest.fn(),
}));

const mockGetChurchServiceTimeZone = jest.mocked(getChurchServiceTimeZone);
const mockConnectAuthenticatedSse = jest.mocked(connectAuthenticatedSse);
const streamConnections: Array<{
  path: string;
  handlers: AuthenticatedSseHandlers;
  extraHeaders?: Record<string, string>;
  close: () => void;
}> = [];

const serviceTimeZoneResult = (
  serviceTimeZone: string | null,
  isConfigured = true,
  serviceTimeZoneRevision = "revision-1",
) => ({
  success: true,
  serviceTimeZone,
  isConfigured,
  legacyTimeZoneSuggestion: null,
  serviceTimeZoneRevision,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("ChurchServiceTimeZoneProvider", () => {
  let churchId: string;
  let deviceId: string;
  let userId: string;
  let sessionKind: string;
  let realtimeConnected: boolean;

  const wrapper = ({ children }: PropsWithChildren) => (
    <GlobalInfoContext.Provider
      value={createMockGlobalContext({
        churchId,
        userId,
        loginState: "success",
        sessionKind,
        device: { deviceId },
        realtimeConnected,
      }) as React.ContextType<typeof GlobalInfoContext>}
    >
      <ChurchServiceTimeZoneProvider>{children}</ChurchServiceTimeZoneProvider>
    </GlobalInfoContext.Provider>
  );

  const emitRevision = (serviceTimeZoneRevision: string) => {
    const connection = streamConnections.at(-1);
    if (!connection) throw new Error("Expected an active time zone SSE connection.");
    act(() => {
      connection.handlers.onMessage(JSON.stringify({
        type: "service-time-zone-revision",
        churchId,
        serviceTimeZoneRevision,
      }));
    });
  };

  beforeEach(() => {
    churchId = "church-a";
    deviceId = "device-a";
    userId = "user-a";
    sessionKind = "human";
    realtimeConnected = false;
    setDisplayToken("");
    mockGetChurchServiceTimeZone.mockReset();
    streamConnections.length = 0;
    mockConnectAuthenticatedSse.mockReset();
    mockConnectAuthenticatedSse.mockImplementation((
      path,
      handlers,
      extraHeaders,
    ) => {
      const close = jest.fn();
      streamConnections.push({ path, handlers, extraHeaders, close });
      return close;
    });
  });

  it("exposes loading until the initial church time zone request succeeds", async () => {
    const pending = deferred<ReturnType<typeof serviceTimeZoneResult>>();
    mockGetChurchServiceTimeZone.mockReturnValue(pending.promise as never);
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });

    expect(result.current.status).toBe("loading");
    expect(result.current.timeZone).toBeNull();
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledWith("church-a");

    await act(async () => pending.resolve(serviceTimeZoneResult("America/New_York")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.timeZone).toBe("America/New_York");
    expect(result.current.isConfigured).toBe(true);
  });

  it("keeps date-based actions unavailable after an initial request failure and restores them on retry", async () => {
    mockGetChurchServiceTimeZone
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never);
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.timeZone).toBeNull();
    expect(result.current.isConfigured).toBe(false);
    expect(result.current.refreshIssue?.kind).toBe("unavailable");

    await act(async () => result.current.refresh());
    expect(result.current.status).toBe("ready");
    expect(result.current.timeZone).toBe("America/New_York");
    expect(result.current.isConfigured).toBe(true);
    expect(result.current.refreshIssue).toBeNull();
  });

  it("keeps the time zone unavailable when the church has no configuration", async () => {
    mockGetChurchServiceTimeZone.mockResolvedValue(
      serviceTimeZoneResult(null, false) as never,
    );
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.timeZone).toBeNull();
    expect(result.current.isConfigured).toBe(false);
  });

  it("keeps the last successful value ready through a transient refresh failure and adopts recovery", async () => {
    mockGetChurchServiceTimeZone
      .mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(serviceTimeZoneResult("America/Chicago") as never);
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await expect(result.current.refresh()).rejects.toThrow("offline");
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.timeZone).toBe("America/New_York");
    expect(result.current.refreshIssue?.kind).toBe("unavailable");

    await act(async () => result.current.refresh());
    expect(result.current.status).toBe("ready");
    expect(result.current.timeZone).toBe("America/Chicago");
    expect(result.current.refreshIssue).toBeNull();
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(3);
  });

  it("keeps a same-scope confirmed value while surfacing an authorization refresh failure", async () => {
    mockGetChurchServiceTimeZone
      .mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never)
      .mockRejectedValueOnce(new AuthApiError("Forbidden", { status: 403 }));
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await expect(result.current.refresh()).rejects.toThrow("Forbidden");
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.timeZone).toBe("America/New_York");
    expect(result.current.refreshIssue?.kind).toBe("permission");
  });

  it("reopens the revision stream after a successful manual recovery", async () => {
    mockGetChurchServiceTimeZone
      .mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never)
      .mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never);
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(streamConnections).toHaveLength(1);

    act(() => streamConnections[0].handlers.onError({ kind: "authentication", status: 401 }));
    expect(result.current.refreshIssue?.kind).toBe("authentication");
    expect(result.current.status).toBe("ready");
    expect(result.current.timeZone).toBe("America/New_York");
    await act(async () => result.current.refresh());

    expect(streamConnections).toHaveLength(2);
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(2);
    expect(result.current.refreshIssue).toBeNull();
  });

  it.each([401, 403, 400])("keeps the actual gate quiet after a background HTTP %s failure", async (status) => {
    mockGetChurchServiceTimeZone.mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never);
    render(<MemoryRouter><ChurchServiceTimeZoneGate area="Schedules"><p>Schedule editor</p></ChurchServiceTimeZoneGate></MemoryRouter>, { wrapper });
    expect(await screen.findByText("Schedule editor")).toBeInTheDocument();
    mockGetChurchServiceTimeZone.mockRejectedValueOnce(new AuthApiError("Refresh failed", { status }));
    emitRevision("revision-2");
    await waitFor(() => expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Schedule editor")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not expose a prior device value and ignores its late response", async () => {
    const oldRequest = deferred<ReturnType<typeof serviceTimeZoneResult>>();
    const newRequest = deferred<ReturnType<typeof serviceTimeZoneResult>>();
    mockGetChurchServiceTimeZone
      .mockReturnValueOnce(oldRequest.promise as never)
      .mockReturnValueOnce(newRequest.promise as never);
    const { result, rerender } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    const adoptFromOldScope = result.current.adoptSavedTimeZone;
    deviceId = "device-b";
    rerender();
    expect(result.current.status).toBe("loading");
    expect(result.current.timeZone).toBeNull();
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(2);

    await act(async () => {
      oldRequest.resolve(serviceTimeZoneResult("Europe/London", true, "revision-old"));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("loading");
    expect(result.current.timeZone).toBeNull();

    await act(async () => newRequest.resolve(
      serviceTimeZoneResult("America/Chicago", true, "revision-device-b"),
    ));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.timeZone).toBe("America/Chicago");
    act(() => adoptFromOldScope(
      serviceTimeZoneResult("Europe/London", true, "revision-old-save"),
    ));
    expect(result.current.timeZone).toBe("America/Chicago");
  });

  it.each(["user", "session"] as const)(
    "starts a fresh request when the human identity %s changes",
    async (identity) => {
      mockGetChurchServiceTimeZone
        .mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never)
        .mockResolvedValueOnce(serviceTimeZoneResult("America/Chicago") as never);
      const { result, rerender } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe("ready"));

      if (identity === "user") userId = "user-b";
      else sessionKind = "workstation";
      rerender();

      expect(result.current.status).toBe("loading");
      expect(result.current.timeZone).toBeNull();
      await waitFor(() => expect(result.current.timeZone).toBe("America/Chicago"));
      expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(2);
    },
  );

  it("does not reload on elapsed time, browser online, realtime reconnect, or rerender", async () => {
    jest.useFakeTimers();
    try {
      mockGetChurchServiceTimeZone.mockResolvedValue(
        serviceTimeZoneResult("America/New_York") as never,
      );
      const { rerender } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event("online"));
      realtimeConnected = true;
      rerender();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(120_000);
        await Promise.resolve();
      });
      rerender();
      expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not reload when the route child changes under the mounted provider", async () => {
    mockGetChurchServiceTimeZone.mockResolvedValue(
      serviceTimeZoneResult("America/New_York") as never,
    );
    const tree = (routeName: string) => (
      <GlobalInfoContext.Provider
        value={createMockGlobalContext({
          churchId,
          userId,
          loginState: "success",
          sessionKind,
          device: { deviceId },
        }) as React.ContextType<typeof GlobalInfoContext>}
      >
        <ChurchServiceTimeZoneProvider>
          <div>{routeName}</div>
        </ChurchServiceTimeZoneProvider>
      </GlobalInfoContext.Provider>
    );
    const view = render(tree("teams"));
    await waitFor(() => expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(1));

    view.rerender(tree("controller"));
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(1);
  });

  it("fetches once when the stream reports a changed revision", async () => {
    mockGetChurchServiceTimeZone
      .mockResolvedValueOnce(serviceTimeZoneResult("America/New_York", true, "revision-1") as never)
      .mockResolvedValueOnce(serviceTimeZoneResult("America/Chicago", true, "revision-2") as never);
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await waitFor(() => expect(result.current.timeZone).toBe("America/New_York"));

    expect(streamConnections[0].path).toBe(
      "api/churches/church-a/service-time-zone/stream",
    );
    emitRevision("revision-2");
    await waitFor(() => expect(result.current.timeZone).toBe("America/Chicago"));
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when a reconnect snapshot matches the loaded revision", async () => {
    mockGetChurchServiceTimeZone.mockResolvedValue(
      serviceTimeZoneResult("America/New_York", true, "revision-1") as never,
    );
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    emitRevision("revision-1");
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(1);
  });

  it("coalesces invalidations during a GET and retries once for the latest revision", async () => {
    const initialRequest = deferred<ReturnType<typeof serviceTimeZoneResult>>();
    mockGetChurchServiceTimeZone
      .mockReturnValueOnce(initialRequest.promise as never)
      .mockResolvedValueOnce(serviceTimeZoneResult("America/Chicago", true, "revision-3") as never);
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });

    emitRevision("revision-2");
    emitRevision("revision-3");
    await act(async () => {
      initialRequest.resolve(serviceTimeZoneResult("America/New_York", true, "revision-1"));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.timeZone).toBe("America/Chicago"));
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(2);
  });

  it("passes the paired display credential to the revision stream", async () => {
    sessionKind = "display";
    setDisplayToken("display-credential");
    mockGetChurchServiceTimeZone.mockResolvedValue(
      serviceTimeZoneResult("America/New_York") as never,
    );
    renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await waitFor(() => expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(1));
    expect(streamConnections[0].extraHeaders).toEqual({
      "x-display-token": "display-credential",
    });
  });

  it("closes the previous stream when identity changes and on provider unmount", async () => {
    mockGetChurchServiceTimeZone.mockResolvedValue(
      serviceTimeZoneResult("America/New_York") as never,
    );
    const { rerender, unmount } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await waitFor(() => expect(streamConnections).toHaveLength(1));

    deviceId = "device-b";
    rerender();
    await waitFor(() => expect(streamConnections).toHaveLength(2));
    expect(streamConnections[0].close).toHaveBeenCalledTimes(1);

    unmount();
    expect(streamConnections[1].close).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "authentication"],
    [403, "permission"],
    [404, "configuration"],
  ] as const)(
    "keeps a confirmed value and does not automatically retry a %s failure",
    async (status, issueKind) => {
      mockGetChurchServiceTimeZone
        .mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never)
        .mockRejectedValueOnce(new AuthApiError("Request failed", { status }));
      const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe("ready"));

      await act(async () => {
        await expect(result.current.refresh()).rejects.toThrow("Request failed");
      });
      expect(result.current.status).toBe("ready");
      expect(result.current.timeZone).toBe("America/New_York");
      expect(result.current.refreshIssue?.kind).toBe(issueKind);
      emitRevision("revision-2");
      expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(2);
    },
  );

  it("adopts a saved response without another GET", async () => {
    mockGetChurchServiceTimeZone.mockResolvedValue(
      serviceTimeZoneResult("America/New_York", true, "revision-1") as never,
    );
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.adoptSavedTimeZone(
      serviceTimeZoneResult("America/Chicago", true, "revision-2"),
    ));

    expect(result.current.timeZone).toBe("America/Chicago");
    expect(result.current.refreshIssue).toBeNull();
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(1);
  });

  it("keeps a saved response when an older GET settles afterward", async () => {
    const initialRequest = deferred<ReturnType<typeof serviceTimeZoneResult>>();
    mockGetChurchServiceTimeZone.mockReturnValue(initialRequest.promise as never);
    const { result } = renderHook(() => useChurchServiceTimeZone(), { wrapper });

    act(() => result.current.adoptSavedTimeZone(
      serviceTimeZoneResult("America/Chicago", true, "revision-saved"),
    ));
    expect(result.current.timeZone).toBe("America/Chicago");

    await act(async () => initialRequest.resolve(
      serviceTimeZoneResult("America/New_York", true, "revision-stale"),
    ));
    expect(result.current.timeZone).toBe("America/Chicago");
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(1);
  });

  it("does not expose another church's time zone or adopt its late response", async () => {
    const churchA = deferred<ReturnType<typeof serviceTimeZoneResult>>();
    const churchB = deferred<ReturnType<typeof serviceTimeZoneResult>>();
    mockGetChurchServiceTimeZone
      .mockReturnValueOnce(churchA.promise as never)
      .mockReturnValueOnce(churchB.promise as never);
    const { result, rerender } = renderHook(() => useChurchServiceTimeZone(), { wrapper });

    churchId = "church-b";
    rerender();
    expect(result.current.status).toBe("loading");
    expect(result.current.timeZone).toBeNull();
    expect(mockGetChurchServiceTimeZone).toHaveBeenLastCalledWith("church-b");

    await act(async () => churchA.resolve(serviceTimeZoneResult("America/New_York")));
    expect(result.current.status).toBe("loading");
    expect(result.current.timeZone).toBeNull();

    await act(async () => churchB.resolve(serviceTimeZoneResult("Europe/London")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.timeZone).toBe("Europe/London");
  });
});
