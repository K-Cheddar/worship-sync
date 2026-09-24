import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { onValue, ref, runTransaction } from "firebase/database";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  useRemoteMediaPreparationManifest,
  usePublishMediaPreparationManifest,
} from "./useMediaPreparationManifest";
import {
  mediaPreparationManifestToCandidates,
  type MediaPreparationManifest,
} from "../utils/mediaPreparationManifest";
import type { ElectronMediaDiscovery } from "../utils/electronMediaSurfaceDiagnostics";

jest.mock("firebase/database", () => ({
  onValue: jest.fn(),
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
