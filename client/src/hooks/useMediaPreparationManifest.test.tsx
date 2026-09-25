import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { onValue, ref, runTransaction } from "firebase/database";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  useRemoteMediaPreparationManifest,
  useRemoteMediaPreparationReadinessReports,
  usePublishMediaPreparationManifest,
} from "./useMediaPreparationManifest";
import {
  mediaPreparationManifestToCandidates,
  type MediaPreparationManifest,
} from "../utils/mediaPreparationManifest";
import type { ElectronMediaDiscovery } from "../utils/electronMediaSurfaceDiagnostics";

jest.mock("firebase/database", () => ({
  onValue: jest.fn(),
  onDisconnect: jest.fn(() => ({ remove: jest.fn().mockResolvedValue(undefined) })),
  remove: jest.fn().mockResolvedValue(undefined),
  ref: jest.fn((_db: unknown, path: string) => ({ path })),
  runTransaction: jest.fn(),
}));

const onValueMock = jest.mocked(onValue) as jest.Mock;
const refMock = jest.mocked(ref);
const runTransactionMock = jest.mocked(runTransaction) as jest.Mock;

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
      (_target: unknown, callback: (snapshot: { val: () => unknown }) => void) => {
        callback({ val: () => manifest });
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
    runTransactionMock.mockRejectedValueOnce(new Error("permission denied"));
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
