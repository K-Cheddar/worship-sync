import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { onValue, ref, set } from "firebase/database";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  useRemoteMediaPreparationManifest,
  usePublishMediaPreparationManifest,
} from "./useMediaPreparationManifest";
import type { MediaPreparationManifest } from "../utils/mediaPreparationManifest";
import type { ElectronMediaDiscovery } from "../utils/electronMediaSurfaceDiagnostics";

jest.mock("firebase/database", () => ({
  onValue: jest.fn(),
  ref: jest.fn((_db: unknown, path: string) => ({ path })),
  set: jest.fn(),
}));

const onValueMock = jest.mocked(onValue) as jest.Mock;
const refMock = jest.mocked(ref);
const setMock = jest.mocked(set);

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
    setMock.mockReset();
    setMock.mockResolvedValue(undefined);
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

    await waitFor(() => expect(setMock).toHaveBeenCalled());
    expect(refMock).toHaveBeenCalledWith(
      { name: "shared" },
      "churches/church-1/data/presentation/mediaPreparation/projector",
    );

    setMock.mockClear();
    renderHook(
      () =>
        usePublishMediaPreparationManifest({
          enabled: true,
          discovery,
          outputId: "projector",
        }),
      { wrapper: makeWrapper("display") },
    );
    expect(setMock).not.toHaveBeenCalled();
  });
});
