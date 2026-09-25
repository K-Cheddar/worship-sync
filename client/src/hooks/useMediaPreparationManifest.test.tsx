import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { onDisconnect, onValue, ref, runTransaction, set } from "firebase/database";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  useRemoteMediaPreparationManifest,
  useRemoteMediaPreparationReadinessReports,
  useReportRemoteMediaPreparationReadiness,
  usePublishMediaPreparationManifest,
  MEDIA_READINESS_STATUS_EVENT,
} from "./useMediaPreparationManifest";
import {
  buildMediaPreparationReadinessCounts,
  isMediaPreparationReadinessReport,
  mediaPreparationManifestToCandidates,
  type MediaPreparationManifest,
} from "../utils/mediaPreparationManifest";
import type { ElectronMediaDiscovery } from "../utils/electronMediaSurfaceDiagnostics";

jest.mock("firebase/database", () => ({
  onValue: jest.fn(),
  onDisconnect: jest.fn(() => ({ remove: jest.fn().mockResolvedValue(undefined), cancel: jest.fn().mockResolvedValue(undefined) })),
  remove: jest.fn().mockResolvedValue(undefined),
  set: jest.fn(),
  ref: jest.fn((_db: unknown, path: string) => ({ path })),
  runTransaction: jest.fn(),
}));

const onValueMock = jest.mocked(onValue) as jest.Mock;
const refMock = jest.mocked(ref);
const runTransactionMock = jest.mocked(runTransaction) as jest.Mock;
const setMock = jest.mocked(set) as jest.Mock;
const onDisconnectMock = jest.mocked(onDisconnect) as jest.Mock;

const manifest: MediaPreparationManifest = {
  contract: "worshipsync.media-preparation",
  version: 1,
  revision: 4,
  publishedAt: 100,
  outputId: "projector",
  controllerProfileId: "presentation",
  outlineScope: "presentation",
  outlineId: "outline-1",
  items: [
    {
      itemId: "item-1",
      itemIndex: 0,
      itemName: "Opening",
      media: [
        {
          mediaKey: "remote:opening",
          source: {
            kind: "remote-url",
            url: "https://cdn.example.com/opening.mp4",
          },
        },
      ],
    },
  ],
};

describe("useRemoteMediaPreparationManifest", () => {
  beforeEach(() => {
    onValueMock.mockReset();
    refMock.mockClear();
    runTransactionMock.mockReset();
    setMock.mockReset();
    onDisconnectMock.mockReset();
    onDisconnectMock.mockImplementation(() => ({ remove: jest.fn().mockResolvedValue(undefined), cancel: jest.fn().mockResolvedValue(undefined) }) as never);
    runTransactionMock.mockImplementation(
      async (_target: unknown, update: (current: unknown) => unknown) => {
        const value = update(undefined);
        return { snapshot: { val: () => value } };
      },
    );
    localStorage.clear();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        ensureMediaCached: jest.fn().mockResolvedValue({
          cacheMap: {
            "https://cdn.example.com/opening.mp4":
              "media-cache://opening.mp4",
          },
        }),
      },
    });
    onValueMock.mockImplementation(
      (target: { path?: string }, callback: (snapshot: { val: () => unknown }) => void) => {
        callback({ val: () => target.path === ".info/connected" ? true : manifest });
        return jest.fn();
      },
    );
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("accepts only fresh readiness reports whose payload identity matches its output/device/session path", async () => {
    const reportedAt = Date.now();
    const validReport = {
      contract: "worshipsync.media-preparation-readiness",
      version: 1,
      outputId: "projector",
      deviceId: "device-1",
      sessionId: "session-1",
      reportedAt,
      manifestRevision: 4,
      manifestReceivedAt: reportedAt - 100,
      source: "remote-manifest",
      candidateCount: 2,
      finiteCandidateCount: 2,
      pendingCacheCount: 0,
      readyCount: 1,
      preparingCount: 1,
      failedCount: 0,
      errors: [],
    };
    onValueMock.mockImplementationOnce((_target: unknown, callback: (snapshot: { val: () => unknown }) => void) => {
      callback({ val: () => ({
        "device-1": {
          "session-1": validReport,
          "other-session": { ...validReport, sessionId: "session-1" },
          "stale-session": { ...validReport, sessionId: "stale-session", reportedAt: reportedAt - 25 * 60 * 60_000 },
        },
      }) });
      return jest.fn();
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={{ firebaseDb: { name: "shared" }, churchId: "church-1", sharedDataReady: true } as never}
      >{children}</GlobalInfoContext.Provider>
    );
    const { result } = renderHook(
      () => useRemoteMediaPreparationReadinessReports({ enabled: true, outputId: "projector" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({ deviceId: "device-1", sessionId: "session-1", manifestRevision: 4 });
  });

  it("retains report state during a transient subscription error and recovers on reconnect", async () => {
    jest.useFakeTimers();
    const reportedAt = Date.now();
    const value = { "device-1": { "session-1": {
      contract: "worshipsync.media-preparation-readiness", version: 1,
      outputId: "projector", deviceId: "device-1", sessionId: "session-1", reportedAt,
      manifestRevision: 4, manifestReceivedAt: reportedAt - 100, source: "remote-manifest",
      candidateCount: 1, finiteCandidateCount: 1, pendingCacheCount: 0,
      readyCount: 1, preparingCount: 0, failedCount: 0, errors: [],
    } } };
    let reportAttempt = 0;
    onValueMock.mockImplementation((target: { path?: string }, onData: (snapshot: { val: () => unknown }) => void, onError: (error: Error) => void) => {
      if (target.path === ".info/connected") { onData({ val: () => true }); return jest.fn(); }
      reportAttempt += 1;
      if (reportAttempt === 1) onError(new Error("network unavailable"));
      else onData({ val: () => value });
      return jest.fn();
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-1", sharedDataReady: true } as never}>{children}</GlobalInfoContext.Provider>
    );
    const { result, unmount } = renderHook(
      () => useRemoteMediaPreparationReadinessReports({ enabled: true, outputId: "projector" }),
      { wrapper },
    );
    try {
      expect(result.current).toEqual([]);
      act(() => window.dispatchEvent(new Event("online")));
      await waitFor(() => expect(result.current).toHaveLength(1));
      expect(onValueMock).toHaveBeenCalledTimes(3);
    } finally {
      unmount();
      jest.useRealTimers();
    }
  });

  it("reports permission denial without dropping reports and recovers through permission-aware reattachment", async () => {
    jest.useFakeTimers();
    const reportedAt = Date.now();
    const value = { "device-1": { "session-1": {
      contract: "worshipsync.media-preparation-readiness", version: 1,
      outputId: "projector", deviceId: "device-1", sessionId: "session-1", reportedAt,
      manifestRevision: 4, manifestReceivedAt: reportedAt - 100, source: "remote-manifest",
      candidateCount: 1, finiteCandidateCount: 1, pendingCacheCount: 0,
      readyCount: 1, preparingCount: 0, failedCount: 0, errors: [],
    } } };
    let reportAttempt = 0;
    onValueMock.mockImplementation((target: { path?: string }, onData: (snapshot: { val: () => unknown }) => void, onError: (error: Error) => void) => {
      if (target.path === ".info/connected") { onData({ val: () => true }); return jest.fn(); }
      reportAttempt += 1;
      if (reportAttempt === 1) onError(Object.assign(new Error("Permission denied"), { code: "PERMISSION_DENIED" }));
      else onData({ val: () => value });
      return jest.fn();
    });
    const states: string[] = [];
    const onStatus = (event: Event) => states.push((event as CustomEvent<{ state: string }>).detail.state);
    window.addEventListener(MEDIA_READINESS_STATUS_EVENT, onStatus);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-1", sharedDataReady: true } as never}>{children}</GlobalInfoContext.Provider>
    );
    const { result, unmount } = renderHook(
      () => useRemoteMediaPreparationReadinessReports({ enabled: true, outputId: "projector" }),
      { wrapper },
    );
    try {
      expect(states).toContain("permission-denied");
      await act(async () => { await jest.advanceTimersByTimeAsync(100); });
      expect(result.current).toHaveLength(1);
      expect(states).toContain("reporting");
      expect(onValueMock).toHaveBeenCalledTimes(3);
    } finally {
      unmount();
      window.removeEventListener(MEDIA_READINESS_STATUS_EVENT, onStatus);
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("ignores a readiness snapshot from the previous output and church after the subscription changes", async () => {
    const callbacks: Array<(snapshot: { val: () => unknown }) => void> = [];
    const unsubscribe = jest.fn();
    onValueMock.mockImplementation((target: { path?: string }, onData: (snapshot: { val: () => unknown }) => void) => {
      if (target.path === ".info/connected") return jest.fn();
      callbacks.push(onData);
      return unsubscribe;
    });
    let activeChurch = "church-old";
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: activeChurch, sharedDataReady: true } as never}>{children}</GlobalInfoContext.Provider>
    );
    const makePayload = (outputId: string, deviceId: string, sessionId: string) => ({ [encodeURIComponent(deviceId)]: { [encodeURIComponent(sessionId)]: {
      contract: "worshipsync.media-preparation-readiness", version: 1, outputId, deviceId, sessionId,
      reportedAt: Date.now(), manifestRevision: null, manifestReceivedAt: null, source: "local-fallback",
      candidateCount: 0, finiteCandidateCount: 0, pendingCacheCount: 0, readyCount: 0,
      preparingCount: 0, failedCount: 0, errors: [],
    } } });
    const view = renderHook(({ outputId }: { outputId: string }) => useRemoteMediaPreparationReadinessReports({ enabled: true, outputId }), {
      initialProps: { outputId: "projector" }, wrapper,
    });
    act(() => callbacks[0]({ val: () => makePayload("projector", "old-device", "old-session") }));
    await waitFor(() => expect(view.result.current[0]?.deviceId).toBe("old-device"));

    activeChurch = "church-new";
    view.rerender({ outputId: "lobby" });
    expect(unsubscribe).toHaveBeenCalled();
    act(() => {
      callbacks[0]({ val: () => makePayload("projector", "old-device", "old-session") });
      callbacks[1]({ val: () => makePayload("lobby", "new-device", "new-session") });
    });
    await waitFor(() => expect(view.result.current.map((report) => report.deviceId)).toEqual(["new-device"]));
    view.unmount();
  });

  it("does not retry a permission-denied readiness write until a connection signal", async () => {
    jest.useFakeTimers();
    setMock.mockRejectedValueOnce({ code: "PERMISSION_DENIED" }).mockResolvedValueOnce(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-report", sharedDataReady: true } as never}>{children}</GlobalInfoContext.Provider>
    );
    const view = renderHook(() => useReportRemoteMediaPreparationReadiness({
      enabled: true, outputId: "projector", source: "browser-poster",
      candidateCount: 0, finiteCandidateCount: 0, pendingCacheCount: 0, readyCount: 0,
      preparingCount: 0, failedCount: 0, errors: [],
    }), { wrapper });
    try {
      await act(async () => { await Promise.resolve(); });
      expect(setMock).toHaveBeenCalledTimes(1);
      await act(async () => { await jest.advanceTimersByTimeAsync(20_000); });
      expect(setMock).toHaveBeenCalledTimes(1);
      act(() => window.dispatchEvent(new Event("online")));
      await act(async () => { await Promise.resolve(); });
      expect(setMock).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      await act(async () => { await jest.advanceTimersByTimeAsync(20_000); });
      expect(setMock).toHaveBeenCalledTimes(2);
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("retries a transient readiness write and serializes a valid recovered report", async () => {
    jest.useFakeTimers();
    setMock.mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-report", sharedDataReady: true } as never}>
        {children}
      </GlobalInfoContext.Provider>
    );
    const statusEvents: string[] = [];
    const onStatus = (event: Event) => statusEvents.push((event as CustomEvent<{ state: string }>).detail.state);
    window.addEventListener(MEDIA_READINESS_STATUS_EVENT, onStatus);
    const stageCounts = buildMediaPreparationReadinessCounts(
      [{ mediaKey: "mux:hls", status: "pending-cache" }],
      [{ mediaKey: "mux:hls", phase: "error" }],
    );
    const view = renderHook(() => useReportRemoteMediaPreparationReadiness({
      enabled: true,
      outputId: "projector",
      source: "remote-manifest",
      ...stageCounts,
      errors: ["Mux finite rendition failed"],
      manifest,
      manifestReceivedAt: 90,
    }), { wrapper });
    try {
      await act(async () => { await Promise.resolve(); });
      expect(setMock).toHaveBeenCalledTimes(1);
      await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
      expect(setMock).toHaveBeenCalledTimes(2);
      const serialized = setMock.mock.calls[1][1];
      expect(isMediaPreparationReadinessReport(serialized)).toBe(true);
      expect(serialized).toMatchObject({ finiteCandidateCount: 0, pendingCacheCount: 1, pendingCacheFailedCount: 1, selectedCandidateCount: 1, selectedFiniteCandidateCount: 0, selectedPendingCacheCount: 1, mountedSurfaceCount: 0, errors: ["Mux finite rendition failed"] });
      expect(statusEvents).toContain("temporarily-unavailable");
      expect(statusEvents).toContain("reporting");
    } finally {
      view.unmount();
      window.removeEventListener(MEDIA_READINESS_STATUS_EVENT, onStatus);
      jest.useRealTimers();
    }
  });

  it("serializes the effective selected pool separately from a larger remote inventory", async () => {
    const inventory = Array.from({ length: 30 }, (_, index) => ({ mediaKey: `remote:${index}`, status: "eligible" as const }));
    const selected = [...inventory.slice(0, 24), { mediaKey: "protected:current", status: "eligible" as const }, { mediaKey: "protected:outgoing", status: "eligible" as const }];
    const surfaces = selected.map(({ mediaKey }) => ({ mediaKey, phase: "ready-paused" }));
    const counts = buildMediaPreparationReadinessCounts(inventory, surfaces, selected, 26);
    setMock.mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-pool-report", sharedDataReady: true } as never}>{children}</GlobalInfoContext.Provider>
    );
    const view = renderHook(() => useReportRemoteMediaPreparationReadiness({
      enabled: true, outputId: "projector", source: "remote-manifest", manifest, manifestReceivedAt: Date.now(), ...counts, errors: [],
    }), { wrapper });
    try {
      await waitFor(() => expect(setMock).toHaveBeenCalled());
      const serialized = setMock.mock.calls.at(-1)?.[1];
      expect(isMediaPreparationReadinessReport(serialized)).toBe(true);
      expect(serialized).toMatchObject({
        candidateCount: 30, finiteCandidateCount: 30, selectedCandidateCount: 26,
        selectedFiniteCandidateCount: 26, selectedFiniteInventoryCount: 24,
        deferredFiniteCount: 6, mountedSurfaceCount: 26, readyCount: 26,
      });
    } finally {
      view.unmount();
    }
  });

  it("re-registers the session-leaf disconnect cleanup after every Firebase reconnection", async () => {
    jest.useFakeTimers();
    let connectedCallback: ((snapshot: { val: () => unknown }) => void) | undefined;
    onDisconnectMock.mockClear();
    onValueMock.mockImplementation((target: { path?: string }, callback: (snapshot: { val: () => unknown }) => void) => {
      if (target.path === ".info/connected") {
        connectedCallback = callback;
        callback({ val: () => true });
      }
      return jest.fn();
    });
    setMock.mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-reconnect", sharedDataReady: true } as never}>{children}</GlobalInfoContext.Provider>
    );
    const view = renderHook(() => useReportRemoteMediaPreparationReadiness({
      enabled: true, outputId: "projector", source: "browser-poster", candidateCount: 0,
      finiteCandidateCount: 0, pendingCacheCount: 0, readyCount: 0, preparingCount: 0, failedCount: 0, errors: [],
    }), { wrapper });
    try {
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(onDisconnectMock).toHaveBeenCalledTimes(1);
      expect(setMock).toHaveBeenCalledTimes(1);
      act(() => connectedCallback?.({ val: () => false }));
      act(() => connectedCallback?.({ val: () => true }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(onDisconnectMock).toHaveBeenCalledTimes(2);
      act(() => connectedCallback?.({ val: () => false }));
      act(() => connectedCallback?.({ val: () => true }));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(onDisconnectMock).toHaveBeenCalledTimes(3);
      expect(onDisconnectMock.mock.calls.map(([target]) => target)).toEqual([onDisconnectMock.mock.calls[0][0], onDisconnectMock.mock.calls[0][0], onDisconnectMock.mock.calls[0][0]]);
    } finally {
      view.unmount();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("waits for disconnect cleanup registration and retries a transient registration failure", async () => {
    jest.useFakeTimers();
    onDisconnectMock.mockClear();
    onDisconnectMock.mockImplementationOnce(() => ({
      remove: jest.fn().mockRejectedValue(new Error("network unavailable")),
      cancel: jest.fn().mockResolvedValue(undefined),
    }) as never);
    onValueMock.mockImplementation((target: { path?: string }, callback: (snapshot: { val: () => unknown }) => void) => {
      if (target.path === ".info/connected") callback({ val: () => true });
      return jest.fn();
    });
    setMock.mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-on-disconnect-retry", sharedDataReady: true } as never}>{children}</GlobalInfoContext.Provider>
    );
    const view = renderHook(() => useReportRemoteMediaPreparationReadiness({
      enabled: true, outputId: "projector", source: "browser-poster", candidateCount: 0,
      finiteCandidateCount: 0, pendingCacheCount: 0, readyCount: 0, preparingCount: 0, failedCount: 0, errors: [],
    }), { wrapper });
    try {
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(setMock).not.toHaveBeenCalled();
      await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
      expect(onDisconnectMock).toHaveBeenCalledTimes(2);
      expect(setMock).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("stops heartbeat writes after bounded transient failures and resumes after reconnection", async () => {
    jest.useFakeTimers();
    setMock.mockRejectedValue(new Error("network unavailable"));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-report-limit", sharedDataReady: true } as never}>
        {children}
      </GlobalInfoContext.Provider>
    );
    const view = renderHook(() => useReportRemoteMediaPreparationReadiness({
      enabled: true, outputId: "projector", source: "browser-poster", candidateCount: 0,
      finiteCandidateCount: 0, pendingCacheCount: 0, readyCount: 0,
      preparingCount: 0, failedCount: 0, errors: [],
    }), { wrapper });
    try {
      await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
      expect(setMock).toHaveBeenCalledTimes(4);
      await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
      expect(setMock).toHaveBeenCalledTimes(4);
      act(() => window.dispatchEvent(new Event("online")));
      await act(async () => { await Promise.resolve(); });
      expect(setMock).toHaveBeenCalledTimes(5);
    } finally {
      view.unmount();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("cancels stale readiness retries across output and church changes and cleans up on unmount", async () => {
    jest.useFakeTimers();
    setMock.mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValue(undefined);
    let activeChurch = "church-old";
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: activeChurch, sharedDataReady: true } as never}>{children}</GlobalInfoContext.Provider>
    );
    const view = renderHook(({ outputId }: { outputId: string }) => useReportRemoteMediaPreparationReadiness({
      enabled: true, outputId, source: "browser-poster", candidateCount: 0,
      finiteCandidateCount: 0, pendingCacheCount: 0, readyCount: 0,
      preparingCount: 0, failedCount: 0, errors: [],
    }), { initialProps: { outputId: "projector" }, wrapper });
    try {
      await act(async () => { await Promise.resolve(); });
      expect(setMock).toHaveBeenCalledTimes(1);
      activeChurch = "church-new";
      view.rerender({ outputId: "lobby" });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(setMock).toHaveBeenCalledTimes(2);
      expect(refMock).toHaveBeenCalledWith({ name: "shared" }, expect.stringContaining("churches/church-new/data/presentation/mediaPreparationReadiness/lobby"));
      await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
      expect(setMock).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      await act(async () => { await jest.advanceTimersByTimeAsync(20_000); });
      expect(setMock).toHaveBeenCalledTimes(2);
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("receives a manifest without a controller database and warms only local cache state", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: { name: "shared" },
            churchId: "church-1",
            sharedDataReady: true,
            sessionKind: "display",
          } as never
        }
      >
        {children}
      </GlobalInfoContext.Provider>
    );

    const { result } = renderHook(
      () =>
        useRemoteMediaPreparationManifest({
          enabled: true,
          outputId: "projector",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.manifest).toEqual(manifest));
    await waitFor(() =>
      expect(result.current.cacheMap).toEqual({
        "https://cdn.example.com/opening.mp4": "media-cache://opening.mp4",
      }),
    );
    expect(refMock).toHaveBeenCalledWith(
      { name: "shared" },
      "churches/church-1/data/presentation/mediaPreparation/projector",
    );
  });

  it("keeps a newer cached revision when an older live Firebase revision arrives", async () => {
    localStorage.setItem(
      "worshipsync:media-preparation:church-1:projector",
      JSON.stringify({ ...manifest, revision: 12 }),
    );
    onValueMock.mockImplementation(
      (_target: unknown, callback: (snapshot: { val: () => unknown }) => void) => {
        callback({ val: () => ({ ...manifest, revision: 1 }) });
        return jest.fn();
      },
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: { name: "shared" },
            churchId: "church-1",
            sharedDataReady: true,
            sessionKind: "display",
          } as never
        }
      >
        {children}
      </GlobalInfoContext.Provider>
    );

    const { result } = renderHook(
      () =>
        useRemoteMediaPreparationManifest({
          enabled: true,
          outputId: "projector",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.manifest?.revision).toBe(12));
    expect(
      JSON.parse(
        localStorage.getItem(
          "worshipsync:media-preparation:church-1:projector",
        ) ?? "null",
    ).revision,
    ).toBe(12);
  });

  it("clears a cached manifest when Firebase authoritatively has no usable value", async () => {
    const key = "worshipsync:media-preparation:church-1:projector";
    localStorage.setItem(key, JSON.stringify(manifest));
    let listener: ((snapshot: { val: () => unknown }) => void) | undefined;
    onValueMock.mockImplementation(
      (_target: unknown, callback: (snapshot: { val: () => unknown }) => void) => {
        listener = callback;
        callback({ val: () => manifest });
        return jest.fn();
      },
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: { name: "shared" },
            churchId: "church-1",
            sharedDataReady: true,
            sessionKind: "display",
          } as never
        }
      >
        {children}
      </GlobalInfoContext.Provider>
    );
    const { result } = renderHook(
      () =>
        useRemoteMediaPreparationManifest({
          enabled: true,
          outputId: "projector",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.manifest).toEqual(manifest));
    act(() => listener?.({ val: () => null }));

    await waitFor(() => expect(result.current.manifest).toBeUndefined());
    expect(result.current.cacheMap).toEqual({});
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("keeps a valid cached manifest available before the first Firebase snapshot", async () => {
    const key = "worshipsync:media-preparation:church-offline:projector";
    localStorage.setItem(key, JSON.stringify(manifest));
    let listener: ((snapshot: { val: () => unknown }) => void) | undefined;
    onValueMock.mockImplementation(
      (_target: unknown, callback: (snapshot: { val: () => unknown }) => void) => {
        listener = callback;
        return jest.fn();
      },
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: { name: "shared" },
            churchId: "church-offline",
            sharedDataReady: true,
            sessionKind: "display",
          } as never
        }
      >
        {children}
      </GlobalInfoContext.Provider>
    );
    const { result } = renderHook(
      () =>
        useRemoteMediaPreparationManifest({
          enabled: true,
          outputId: "projector",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.manifest).toEqual(manifest));
    expect(listener).toBeDefined();
  });

  it("loads the exact church/output cache provisionally and clears old state on identity change", async () => {
    const secondManifest = {
      ...manifest,
      outputId: "tvs",
      outlineId: "outline-2",
      items: manifest.items.map((item) => ({
        ...item,
        media: item.media.map((media) => ({
          ...media,
          source: { ...media.source, url: "https://cdn.example.com/tvs.mp4" },
        })),
      })),
    };
    localStorage.setItem(
      "worshipsync:media-preparation:church-1:projector",
      JSON.stringify(manifest),
    );
    localStorage.setItem(
      "worshipsync:media-preparation:church-2:tvs",
      JSON.stringify(secondManifest),
    );
    let currentGlobal = {
      firebaseDb: { name: "shared" },
      churchId: "church-1",
      sharedDataReady: true,
      sessionKind: "display",
    };
    onValueMock.mockImplementation(
      (target: { path: string }, callback: (snapshot: { val: () => unknown }) => void) => {
        const value = target.path.endsWith("/tvs") ? secondManifest : manifest;
        callback({ val: () => value });
        return jest.fn();
      },
    );
    window.electronAPI!.ensureMediaCached = jest.fn(async (sources: string[]) => ({
      requested: sources.length,
      cacheable: sources.length,
      downloaded: sources.length,
      failed: 0,
      cacheMap: Object.fromEntries(
        sources.map((source) => [
          source,
          `media-cache://${source.includes("tvs") ? "tvs" : "projector"}.mp4`,
        ]),
      ),
    }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={currentGlobal as never}>
        {children}
      </GlobalInfoContext.Provider>
    );
    const view = renderHook(
      ({ outputId }: { outputId: string }) =>
        useRemoteMediaPreparationManifest({ enabled: true, outputId }),
      { initialProps: { outputId: "projector" }, wrapper },
    );

    await waitFor(() => expect(view.result.current.manifest).toEqual(manifest));
    await waitFor(() =>
      expect(view.result.current.cacheMap).toEqual(
        expect.objectContaining({
          "https://cdn.example.com/opening.mp4": "media-cache://projector.mp4",
        }),
      ),
    );
    currentGlobal = { ...currentGlobal, churchId: "church-2" };
    view.rerender({ outputId: "tvs" });

    await waitFor(() => expect(view.result.current.manifest).toEqual(secondManifest));
    await waitFor(() =>
      expect(Object.keys(view.result.current.cacheMap)).toEqual([
        "https://cdn.example.com/tvs.mp4",
      ]),
    );
    expect(view.result.current.manifest?.outputId).toBe("tvs");
  });

  it("publishes a loaded controller manifest and skips display sessions", async () => {
    const discovery: ElectronMediaDiscovery = {
      renderer: "projector",
      outputId: "projector",
      controllerProfileId: "presentation",
      outlineScope: "presentation",
      outlineId: "outline-1",
      outlineLoadState: "loaded",
      itemCount: 1,
      uniqueFiniteVideoCount: 1,
      items: [
        {
          itemIndex: 0,
          itemId: "item-1",
          itemName: "Opening",
          videos: [
            {
              mediaKey: "remote:opening",
              source: "https://cdn.example.com/opening.mp4",
              sourceKind: "remote",
              status: "eligible",
              cacheStatus: "not-required",
            },
          ],
        },
      ],
    };
    const makeWrapper = (sessionKind: "controller" | "display") =>
      ({ children }: { children: ReactNode }) => (
        <GlobalInfoContext.Provider
          value={
            {
              firebaseDb: { name: "shared" },
              churchId: "church-1",
              sharedDataReady: true,
              sessionKind,
            } as never
          }
        >
          {children}
        </GlobalInfoContext.Provider>
      );

    renderHook(
      () =>
        usePublishMediaPreparationManifest({
          enabled: true,
          discovery,
          outputId: "projector",
        }),
      {
        wrapper: makeWrapper("controller"),
      },
    );

    await waitFor(() => expect(runTransactionMock).toHaveBeenCalled());
    expect(refMock).toHaveBeenCalledWith(
      { name: "shared" },
      "churches/church-1/data/presentation/mediaPreparation/projector",
    );

    runTransactionMock.mockClear();
    renderHook(
      () =>
        usePublishMediaPreparationManifest({
          enabled: true,
          discovery,
          outputId: "projector",
        }),
      { wrapper: makeWrapper("display") },
    );
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it("exposes the desired manifest revision while publishing and preserves failure results", async () => {
    const discovery: ElectronMediaDiscovery = {
      renderer: "projector",
      outputId: "projector",
      outlineId: "outline-1",
      outlineLoadState: "loaded",
      itemCount: 0,
      uniqueFiniteVideoCount: 0,
      items: [],
    };
    const statuses: Array<{ state: string; desiredRevision?: number }> = [];
    const onStatus = (event: Event) => {
      const status = (event as CustomEvent<{ state: string; desiredRevision?: number }>).detail;
      statuses.push(status);
    };
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    runTransactionMock.mockRejectedValueOnce({ code: "PERMISSION_DENIED" });
    window.addEventListener("worship-sync-media-manifest-publish-status", onStatus);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={{ firebaseDb: { name: "shared" }, churchId: "church-publish", sharedDataReady: true, sessionKind: "controller" } as never}
      >{children}</GlobalInfoContext.Provider>
    );
    const { unmount } = renderHook(
      () => usePublishMediaPreparationManifest({ enabled: true, discovery, outputId: "projector" }),
      { wrapper },
    );

    await waitFor(() => expect(statuses.map((status) => status.state)).toEqual(expect.arrayContaining(["publishing", "failed"])));
    expect(statuses.find((status) => status.state === "publishing")?.desiredRevision).toBe(1);
    expect(statuses.find((status) => status.state === "failed")?.desiredRevision).toBe(1);
    expect(localStorage.getItem("worshipsync:media-preparation-publication:church-publish:projector")).toContain('"state":"failed"');
    window.removeEventListener("worship-sync-media-manifest-publish-status", onStatus);
    consoleError.mockRestore();
    unmount();
  });

  it("retries a transient manifest transaction once and publishes without changing the desired revision", async () => {
    jest.useFakeTimers();
    const discovery: ElectronMediaDiscovery = {
      renderer: "projector", outputId: "projector", outlineId: "outline-retry",
      outlineLoadState: "loaded", itemCount: 0, uniqueFiniteVideoCount: 0, items: [],
    };
    runTransactionMock.mockRejectedValueOnce(new Error("network unavailable"));
    const states: string[] = [];
    const onStatus = (event: Event) => states.push((event as CustomEvent<{ state: string }>).detail.state);
    window.addEventListener("worship-sync-media-manifest-publish-status", onStatus);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-transient", sharedDataReady: true, sessionKind: "controller" } as never}>{children}</GlobalInfoContext.Provider>
    );
    const view = renderHook(() => usePublishMediaPreparationManifest({ enabled: true, discovery, outputId: "projector" }), { wrapper });
    try {
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(states).toContain("retrying");
      expect(runTransactionMock).toHaveBeenCalledTimes(1);
      await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
      expect(runTransactionMock).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(states).toContain("published"));
      expect(localStorage.getItem("worshipsync:media-preparation-publication:church-transient:projector")).toContain('"desiredRevision":1');
    } finally {
      view.unmount();
      window.removeEventListener("worship-sync-media-manifest-publish-status", onStatus);
      jest.useRealTimers();
    }
  });

  it("retries publication after a long outage without replaying an obsolete outline", async () => {
    jest.useFakeTimers();
    let connectedCallback: ((snapshot: { val: () => unknown }) => void) | undefined;
    let connectionValue = true;
    onValueMock.mockImplementation((target: { path?: string }, callback: (snapshot: { val: () => unknown }) => void) => {
      if (target.path === ".info/connected") {
        connectedCallback = callback;
        callback({ val: () => connectionValue });
      }
      return jest.fn();
    });
    runTransactionMock.mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (_target: unknown, update: (current: unknown) => unknown) => {
        const value = update(undefined);
        return { snapshot: { val: () => value } };
      });
    const makeDiscovery = (outlineId: string): ElectronMediaDiscovery => ({
      renderer: "projector", outputId: "projector", outlineId, outlineLoadState: "loaded", itemCount: 0, uniqueFiniteVideoCount: 0, items: [],
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-long-outage", sharedDataReady: true, sessionKind: "controller" } as never}>{children}</GlobalInfoContext.Provider>
    );
    const view = renderHook(({ discovery }: { discovery: ElectronMediaDiscovery }) => usePublishMediaPreparationManifest({ enabled: true, discovery, outputId: "projector" }), {
      initialProps: { discovery: makeDiscovery("outline-old") }, wrapper,
    });
    try {
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { await jest.advanceTimersByTimeAsync(14_000); });
      expect(runTransactionMock).toHaveBeenCalledTimes(4);
      connectionValue = false;
      act(() => connectedCallback?.({ val: () => false }));
      view.rerender({ discovery: makeDiscovery("outline-current") });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { await jest.advanceTimersByTimeAsync(60 * 60_000); });
      expect(runTransactionMock).toHaveBeenCalledTimes(4);
      connectionValue = true;
      act(() => connectedCallback?.({ val: () => true }));
      connectionValue = false;
      act(() => connectedCallback?.({ val: () => false }));
      connectionValue = true;
      act(() => connectedCallback?.({ val: () => true }));
      await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
      expect(runTransactionMock).toHaveBeenCalledTimes(5);
      const recoveryUpdate = runTransactionMock.mock.calls[4][1] as (current: unknown) => MediaPreparationManifest;
      expect(recoveryUpdate(undefined).outlineId).toBe("outline-current");
    } finally {
      view.unmount();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("cancels an old outline’s scheduled publication retry when a new outline is selected", async () => {
    jest.useFakeTimers();
    const makeDiscovery = (outlineId: string): ElectronMediaDiscovery => ({
      renderer: "projector", outputId: "projector", outlineId,
      outlineLoadState: "loaded", itemCount: 0, uniqueFiniteVideoCount: 0, items: [],
    });
    const publishedOutlines: string[] = [];
    runTransactionMock
      .mockRejectedValueOnce(new Error("temporary disconnect"))
      .mockImplementation(async (_target: unknown, update: (current: unknown) => unknown) => {
        const value = update(undefined) as MediaPreparationManifest;
        publishedOutlines.push(value.outlineId ?? "");
        return { snapshot: { val: () => value } };
      });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-outline-retry", sharedDataReady: true, sessionKind: "controller" } as never}>{children}</GlobalInfoContext.Provider>
    );
    const view = renderHook(
      ({ discovery }: { discovery: ElectronMediaDiscovery }) => usePublishMediaPreparationManifest({ enabled: true, discovery, outputId: "projector" }),
      { initialProps: { discovery: makeDiscovery("outline-old") }, wrapper },
    );
    try {
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(runTransactionMock).toHaveBeenCalledTimes(1);
      view.rerender({ discovery: makeDiscovery("outline-new") });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(runTransactionMock).toHaveBeenCalledTimes(2);
      expect(publishedOutlines).toEqual(["outline-new"]);
      await act(async () => { await jest.advanceTimersByTimeAsync(20_000); });
      expect(runTransactionMock).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("keeps independent manifest transactions for simultaneous outputs", async () => {
    const discovery = (outputId: string, outlineId: string): ElectronMediaDiscovery => ({
      renderer: "projector", outputId, outlineId, outlineLoadState: "loaded",
      itemCount: 0, uniqueFiniteVideoCount: 0, items: [],
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ firebaseDb: { name: "shared" }, churchId: "church-two-outputs", sharedDataReady: true, sessionKind: "controller" } as never}>{children}</GlobalInfoContext.Provider>
    );
    const { unmount } = renderHook(() => {
      usePublishMediaPreparationManifest({ enabled: true, discovery: discovery("projector", "main"), outputId: "projector" });
      usePublishMediaPreparationManifest({ enabled: true, discovery: discovery("lobby", "lobby-outline"), outputId: "lobby" });
    }, { wrapper });
    await waitFor(() => expect(runTransactionMock).toHaveBeenCalledTimes(2));
    expect(refMock).toHaveBeenCalledWith({ name: "shared" }, expect.stringContaining("mediaPreparation/projector"));
    expect(refMock).toHaveBeenCalledWith({ name: "shared" }, expect.stringContaining("mediaPreparation/lobby"));
    unmount();
  });

  it("does not let an older queued outline load publish after a newer selection", async () => {
    const pending: Array<{
      update: (current: unknown) => unknown;
      resolve: (value: unknown) => void;
    }> = [];
    runTransactionMock.mockImplementation(
      async (
        _target: unknown,
        update: (current: unknown) => unknown,
      ) =>
        new Promise((resolve) => {
          pending.push({ update, resolve });
        }),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: { name: "shared" },
            churchId: "church-race",
            sharedDataReady: true,
            sessionKind: "controller",
          } as never
        }
      >
        {children}
      </GlobalInfoContext.Provider>
    );
    const makeDiscovery = (
      outlineId: string,
      outlineLoadState: ElectronMediaDiscovery["outlineLoadState"] = "loaded",
    ): ElectronMediaDiscovery => ({
      renderer: "projector",
      outputId: "race-output",
      controllerProfileId: "aux",
      outlineScope: "aux",
      outlineId,
      outlineLoadState,
      itemCount: 0,
      uniqueFiniteVideoCount: 0,
      items: [],
    });

    const view = renderHook(
      ({ discovery }: { discovery: ElectronMediaDiscovery }) =>
        usePublishMediaPreparationManifest({
          enabled: true,
          discovery,
          outputId: "race-output",
        }),
      {
        initialProps: { discovery: makeDiscovery("outline-a") },
        wrapper,
      },
    );

    await waitFor(() => expect(pending).toHaveLength(1));
    view.rerender({ discovery: makeDiscovery("outline-b", "loading") });

    let staleValue: unknown;
    await act(async () => {
      staleValue = pending[0].update(undefined);
      pending[0].resolve({ snapshot: { val: () => staleValue } });
    });
    view.rerender({ discovery: makeDiscovery("outline-b") });
    await waitFor(() => expect(pending).toHaveLength(2));
    const latestValue = pending[1].update(undefined);
    pending[1].resolve({ snapshot: { val: () => latestValue } });

    expect(staleValue).toBeUndefined();
    await waitFor(() =>
      expect(latestValue).toEqual(
        expect.objectContaining({ outlineId: "outline-b", revision: 1 }),
      ),
    );
  });

  it("repairs missing Firebase state even when local storage already has the desired structure", async () => {
    const discovery: ElectronMediaDiscovery = {
      renderer: "projector",
      controllerProfileId: "presentation",
      outlineScope: "presentation",
      outlineId: "outline-1",
      outlineLoadState: "loaded",
      itemCount: 1,
      uniqueFiniteVideoCount: 1,
      items: [
        {
          itemIndex: 0,
          itemId: "item-1",
          itemName: "Opening",
          videos: [
            {
              mediaKey: "remote:opening",
              source: "https://cdn.example.com/opening.mp4",
              sourceKind: "remote",
              status: "eligible",
              cacheStatus: "not-required",
            },
          ],
        },
      ],
    };
    const key = "worshipsync:media-preparation:church-repair:projector";
    localStorage.setItem(key, JSON.stringify({ ...manifest, revision: 12 }));
    let candidate: unknown;
    runTransactionMock.mockImplementation(
      async (_target: unknown, update: (current: unknown) => unknown) => {
        candidate = update(undefined);
        return { snapshot: { val: () => candidate } };
      },
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: { name: "shared" },
            churchId: "church-repair",
            sharedDataReady: true,
            sessionKind: "controller",
          } as never
        }
      >
        {children}
      </GlobalInfoContext.Provider>
    );

    renderHook(
      () =>
        usePublishMediaPreparationManifest({
          enabled: true,
          discovery,
          outputId: "projector",
        }),
      { wrapper },
    );

    await waitFor(() => expect(runTransactionMock).toHaveBeenCalled());
    expect(candidate).toEqual(expect.objectContaining({ outputId: "projector" }));
    expect((candidate as MediaPreparationManifest).revision).toBe(12);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(key) ?? "null").revision).toBe(12),
    );
  });

  it("returns an identical server manifest without increasing its revision", async () => {
    const discovery: ElectronMediaDiscovery = {
      renderer: "projector",
      controllerProfileId: "presentation",
      outlineScope: "presentation",
      outlineId: "outline-1",
      outlineLoadState: "loaded",
      itemCount: 1,
      uniqueFiniteVideoCount: 1,
      items: [
        {
          itemIndex: 0,
          itemId: "item-1",
          itemName: "Opening",
          videos: [
            {
              mediaKey: "remote:opening",
              source: "https://cdn.example.com/opening.mp4",
              sourceKind: "remote",
              status: "eligible",
              cacheStatus: "not-required",
            },
          ],
        },
      ],
    };
    const serverValue: MediaPreparationManifest = {
      ...manifest,
      revision: 7,
      publishedAt: 123,
    };
    let returned: unknown;
    runTransactionMock.mockImplementation(
      async (_target: unknown, update: (current: unknown) => unknown) => {
        returned = update(serverValue);
        return { snapshot: { val: () => returned } };
      },
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: { name: "shared" },
            churchId: "church-same",
            sharedDataReady: true,
            sessionKind: "controller",
          } as never
        }
      >
        {children}
      </GlobalInfoContext.Provider>
    );

    renderHook(
      () =>
        usePublishMediaPreparationManifest({
          enabled: true,
          discovery,
          outputId: "projector",
        }),
      { wrapper },
    );

    await waitFor(() => expect(returned).toBeDefined());
    expect(returned).toBe(serverValue);
    expect((returned as MediaPreparationManifest).revision).toBe(7);
  });

  it("keeps transaction retries side-effect free until Firebase commits", async () => {
    const discovery: ElectronMediaDiscovery = {
      renderer: "projector",
      controllerProfileId: "presentation",
      outlineScope: "presentation",
      outlineId: "outline-retry",
      outlineLoadState: "loaded",
      itemCount: 0,
      uniqueFiniteVideoCount: 0,
      items: [],
    };
    const key = "worshipsync:media-preparation:church-retry:projector";
    let update: ((current: unknown) => unknown) | undefined;
    let resolveTransaction: ((value: unknown) => void) | undefined;
    runTransactionMock.mockImplementation(
      async (_target: unknown, updater: (current: unknown) => unknown) => {
        update = updater;
        return new Promise((resolve) => {
          resolveTransaction = resolve;
        });
      },
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: { name: "shared" },
            churchId: "church-retry",
            sharedDataReady: true,
            sessionKind: "controller",
          } as never
        }
      >
        {children}
      </GlobalInfoContext.Provider>
    );

    renderHook(
      () =>
        usePublishMediaPreparationManifest({
          enabled: true,
          discovery,
          outputId: "projector",
        }),
      { wrapper },
    );

    await waitFor(() => expect(update).toBeDefined());
    const firstAttempt = update?.(undefined);
    const retryAttempt = update?.(undefined);
    expect(retryAttempt).toEqual(firstAttempt);
    expect(localStorage.getItem(key)).toBeNull();

    await act(async () => {
      resolveTransaction?.({ snapshot: { val: () => retryAttempt } });
    });
    await waitFor(() => expect(localStorage.getItem(key)).not.toBeNull());
  });

  it("feeds a controller-published manifest into the remote candidate contract", async () => {
    let published: MediaPreparationManifest | undefined;
    runTransactionMock.mockImplementation(
      async (_target: unknown, update: (current: unknown) => unknown) => {
        published = update(undefined) as MediaPreparationManifest;
        return { snapshot: { val: () => published } };
      },
    );
    const discovery: ElectronMediaDiscovery = {
      renderer: "projector",
      outputId: "projector",
      controllerProfileId: "presentation",
      outlineScope: "presentation",
      outlineId: "outline-1",
      outlineLoadState: "loaded",
      itemCount: 1,
      uniqueFiniteVideoCount: 1,
      items: [
        {
          itemIndex: 0,
          itemId: "item-1",
          itemName: "Opening",
          videos: [
            {
              mediaKey: "remote:opening",
              source: "https://cdn.example.com/opening.mp4",
              sourceKind: "remote",
              status: "eligible",
              cacheStatus: "not-required",
            },
          ],
        },
      ],
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: { name: "shared" },
            churchId: "church-integrated",
            sharedDataReady: true,
            sessionKind: "controller",
          } as never
        }
      >
        {children}
      </GlobalInfoContext.Provider>
    );

    renderHook(
      () =>
        usePublishMediaPreparationManifest({
          enabled: true,
          discovery,
          outputId: "projector",
        }),
      { wrapper },
    );

    await waitFor(() => expect(published).toBeDefined());
    expect(mediaPreparationManifestToCandidates(published)).toEqual([
      expect.objectContaining({
        mediaKey: "remote:opening",
        source: "https://cdn.example.com/opening.mp4",
        itemId: "item-1",
      }),
    ]);
  });
});
