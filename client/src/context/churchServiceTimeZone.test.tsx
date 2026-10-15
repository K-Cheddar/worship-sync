import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { AuthApiError, getChurchServiceTimeZone } from "../api/auth";
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

const mockGetChurchServiceTimeZone = jest.mocked(getChurchServiceTimeZone);

const serviceTimeZoneResult = (
  serviceTimeZone: string,
  isConfigured = true,
) => ({
  success: true,
  serviceTimeZone,
  isConfigured,
  legacyTimeZoneSuggestion: null,
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
  let realtimeConnected: boolean;

  const wrapper = ({ children }: PropsWithChildren) => (
    <GlobalInfoContext.Provider
      value={createMockGlobalContext({
        churchId,
        loginState: "success",
        sessionKind: "human",
        device: { deviceId },
        realtimeConnected,
      }) as React.ContextType<typeof GlobalInfoContext>}
    >
      <ChurchServiceTimeZoneProvider>{children}</ChurchServiceTimeZoneProvider>
    </GlobalInfoContext.Provider>
  );

  beforeEach(() => {
    churchId = "church-a";
    deviceId = "device-a";
    realtimeConnected = false;
    mockGetChurchServiceTimeZone.mockReset();
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

  it("does not treat the API's unconfigured UTC display value as a service time zone", async () => {
    mockGetChurchServiceTimeZone.mockResolvedValue(
      serviceTimeZoneResult("UTC", false) as never,
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

  it("keeps the church-scoped setting across device changes and ignores the old device response", async () => {
    const oldRequest = deferred<ReturnType<typeof serviceTimeZoneResult>>();
    const newRequest = deferred<ReturnType<typeof serviceTimeZoneResult>>();
    mockGetChurchServiceTimeZone.mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never)
      .mockReturnValueOnce(oldRequest.promise as never).mockReturnValueOnce(newRequest.promise as never);
    const { result, rerender } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    deviceId = "device-b";
    rerender();
    expect(result.current.status).toBe("ready");
    expect(result.current.timeZone).toBe("America/New_York");
    await act(async () => { oldRequest.resolve(serviceTimeZoneResult("Europe/London")); await refresh; });
    expect(result.current.timeZone).toBe("America/New_York");
    await act(async () => newRequest.resolve(serviceTimeZoneResult("America/Chicago")));
    expect(result.current.timeZone).toBe("America/Chicago");
  });

  it("coalesces browser-online and realtime reconnect refreshes", async () => {
    jest.useFakeTimers();
    mockGetChurchServiceTimeZone
      .mockResolvedValueOnce(serviceTimeZoneResult("America/New_York") as never)
      .mockResolvedValueOnce(serviceTimeZoneResult("America/Chicago") as never);
    const { rerender } = renderHook(() => useChurchServiceTimeZone(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    realtimeConnected = true;
    rerender();
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(mockGetChurchServiceTimeZone).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("keeps a confirmed value while reporting authentication and permission failures separately", async () => {
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
