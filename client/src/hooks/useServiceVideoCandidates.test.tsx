import { act, renderHook, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import type { ContextType, ReactNode } from "react";
import { ControllerInfoContext } from "../context/controllerInfo";
import type {
  DBItem,
  DBItemListDetails,
  ItemLists,
  ItemSlideType,
  MediaType,
} from "../types";
import { getVideoBackgroundMediaKey } from "../utils/videoBackgroundPlayback";
import { getLanePreparedMediaKey } from "../components/DisplayWindow/laneBackgroundMedia";
import mediaCacheMapReducer from "../store/mediaCacheMapSlice";
import { useServiceVideoCandidates } from "./useServiceVideoCandidates";

const video = (
  id: string,
  background: string,
  extras: Partial<MediaType> = {},
): MediaType =>
  ({ id, type: "video", background, ...extras }) as unknown as MediaType;

const image = (id: string, background: string): MediaType =>
  ({ id, type: "image", background }) as unknown as MediaType;

const slide = (
  id: string,
  boxes: Array<{ id: string; mediaInfo?: MediaType }>,
  mediaSource?: ItemSlideType["mediaSource"],
): ItemSlideType =>
  ({ id, name: id, type: "Media", boxes, mediaSource }) as ItemSlideType;

const item = (id: string, name: string, slides: ItemSlideType[]): DBItem =>
  ({
    _id: id,
    name,
    slides,
  }) as unknown as DBItem;

const renderCandidates = (
  docs: DBItem[],
  options: {
    currentItemId?: string;
    currentMedia?: { mediaKey: string; source: string };
    outlineId?: string | null;
    outlineItems?: Record<string, string[]>;
    maxSurfaces?: number;
    scope?: "service" | "current-item";
    cacheMap?: Record<string, string>;
    getLocalMediaPath?: jest.Mock;
    ensureMediaCached?: jest.Mock;
  } = {},
) => {
  const cacheMap = options.cacheMap ?? {};
  let currentDocs = docs;
  const configuredOutlineItems = options.outlineItems;
  if (options.getLocalMediaPath) {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { getLocalMediaPath: options.getLocalMediaPath },
    });
  }
  const electronApi = window.electronAPI as
    | { ensureMediaCached?: jest.Mock }
    | undefined;
  if (options.ensureMediaCached) {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        ...(electronApi ?? {}),
        ensureMediaCached: options.ensureMediaCached,
      },
    });
  }
  const db = {
    get: jest.fn(async (id: string) => {
      if (id === "ItemLists") {
        return { activeList: { _id: "list-1" } } as ItemLists;
      }
      const currentDoc = currentDocs.find((doc) => doc._id === id);
      if (currentDoc) return currentDoc;
      return {
        _id: id,
        items: (
          configuredOutlineItems?.[id] ?? currentDocs.map((doc) => doc._id)
        ).map((itemId) => ({ _id: itemId })),
      } as unknown as DBItemListDetails;
    }),
    allDocs: jest.fn(async ({ keys }: { keys: string[] }) => ({
      rows: keys.map((key) => ({
        doc: currentDocs.find((doc) => doc._id === key),
      })),
    })),
  };
  const updater = new EventTarget();
  let currentItemId = options.currentItemId;
  let currentMedia = options.currentMedia;
  const context = {
    db,
    updater,
  } as unknown as ContextType<typeof ControllerInfoContext>;
  const store = configureStore({
    reducer: { mediaCacheMap: mediaCacheMapReducer },
    preloadedState: { mediaCacheMap: { map: cacheMap } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <ControllerInfoContext.Provider value={context}>
        {children}
      </ControllerInfoContext.Provider>
    </Provider>
  );
  const utils = renderHook(
    () =>
      useServiceVideoCandidates({
        enabled: true,
        currentItemId,
        currentMedia,
        outlineId: options.outlineId,
        maxSurfaces: options.maxSurfaces,
        scope: options.scope,
      }),
    { wrapper },
  );
  return {
    ...utils,
    result: utils.result,
    updater,
    db,
    store,
    replaceDocs: (nextDocs: DBItem[]) => {
      currentDocs = nextDocs;
    },
    setCurrentItem: (nextItemId: string | undefined) => {
      currentItemId = nextItemId;
    },
    setCurrentMedia: (
      nextMedia: { mediaKey: string; source: string } | undefined,
    ) => {
      currentMedia = nextMedia;
    },
  };
};

describe("useServiceVideoCandidates", () => {
  beforeEach(() => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getLocalMediaPath: jest.fn().mockResolvedValue(null),
      },
    });
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("includes finite MP4, media-cache, and WorshipSync media sources", async () => {
    const docs = [
      item("item-1", "Song One", [
        slide("slide-1", [
          {
            id: "mp4",
            mediaInfo: video("mp4", "https://cdn.example.com/one.mp4"),
          },
          {
            id: "cache",
            mediaInfo: video("cache", "media-cache://cached.mp4"),
          },
          {
            id: "asset",
            mediaInfo: video("asset", "worshipsync-media://asset/video.mp4"),
          },
        ]),
      ]),
    ];
    const { result } = renderCandidates(docs, { maxSurfaces: 8 });

    await waitFor(() => expect(result.current.candidates).toHaveLength(3));
    expect(
      result.current.candidates.map((candidate) => candidate.source),
    ).toEqual([
      "worshipsync-media://asset/video.mp4",
      "media-cache://cached.mp4",
      "https://cdn.example.com/one.mp4",
    ]);
    expect(
      result.current.diagnostics.every((diagnostic) => diagnostic.eligible),
    ).toBe(true);
  });

  it("includes a Mux HLS source when Electron resolves a cached finite MP4", async () => {
    const originalSource = "https://stream.mux.com/playback-1.m3u8";
    const { result } = renderCandidates(
      [
        item("item-1", "Mux Song", [
          slide("slide-1", [
            { id: "mux", mediaInfo: video("mux", originalSource) },
          ]),
        ]),
      ],
      {
        getLocalMediaPath: jest
          .fn()
          .mockResolvedValue("media-cache://playback-1.mp4"),
      },
    );

    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(result.current.candidates[0]).toMatchObject({
      mediaKey: "remote:mux",
      source: "media-cache://playback-1.mp4",
    });
    expect(result.current.diagnostics[0]).toMatchObject({
      originalSource,
      resolvedSource: "media-cache://playback-1.mp4",
      sourceKind: "cache",
      eligible: true,
      reason: "cached finite MP4 available",
    });
  });

  it("includes a Mux HLS source when the local Electron lookup finds its MP4", async () => {
    const originalSource = "https://stream.mux.com/playback-2/master.m3u8";
    const getLocalMediaPath = jest
      .fn()
      .mockResolvedValue("media-cache://playback-2.mp4");
    const { result } = renderCandidates(
      [
        item("item-1", "Mux Song", [
          slide("slide-1", [
            { id: "mux", mediaInfo: video("mux", originalSource) },
          ]),
        ]),
      ],
      { getLocalMediaPath },
    );

    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(result.current.candidates[0].source).toBe(
      "media-cache://playback-2.mp4",
    );
    expect(getLocalMediaPath).toHaveBeenCalledWith(originalSource);
  });

  it("excludes true HLS, image backgrounds, and local capture inputs with reasons", async () => {
    const hls = "https://example.com/live.m3u8";
    const { result } = renderCandidates([
      item("item-1", "Mixed Item", [
        slide(
          "slide-1",
          [
            { id: "hls", mediaInfo: video("hls", hls) },
            {
              id: "image",
              mediaInfo: image("image", "https://cdn.example.com/still.jpg"),
            },
          ],
          {
            kind: "local-video-input",
            sourceId: "camera-1",
            label: "Camera 1",
          },
        ),
      ]),
    ]);

    await waitFor(() => expect(result.current.diagnostics).toHaveLength(2));
    expect(result.current.candidates).toHaveLength(0);
    expect(result.current.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mediaKey: "remote:hls",
          eligible: false,
          status: "excluded",
          reason: "no finite/cacheable rendition",
        }),
        expect.objectContaining({
          mediaKey: "local:camera-1",
          eligible: false,
          reason: "local capture input is not a finite file video",
        }),
      ]),
    );
  });

  it("marks uncached Mux HLS as pending and requests one additive cache warmup", async () => {
    const ensureMediaCached = jest.fn().mockResolvedValue({
      requested: 1,
      cacheable: 1,
      downloaded: 1,
      failed: 0,
      cacheMap: {},
    });
    const { result } = renderCandidates(
      [
        item("item-1", "Mux Song", [
          slide("slide-1", [
            {
              id: "mux-a",
              mediaInfo: video(
                "mux",
                "https://stream.mux.com/playback-id.m3u8",
              ),
            },
            {
              id: "mux-b",
              mediaInfo: video(
                "mux",
                "https://stream.mux.com/playback-id/master.m3u8",
              ),
            },
            {
              id: "mux-c",
              mediaInfo: video(
                "mux-two",
                "https://stream.mux.com/second-id.m3u8",
              ),
            },
          ]),
        ]),
      ],
      {
        ensureMediaCached,
        getLocalMediaPath: jest.fn().mockResolvedValue(null),
      },
    );

    await waitFor(() =>
      expect(result.current.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mediaKey: "remote:mux",
            status: "pending-cache",
            cacheStatus: "pending",
          }),
        ]),
      ),
    );
    await waitFor(() => expect(ensureMediaCached).toHaveBeenCalledTimes(1));
    expect(ensureMediaCached).toHaveBeenCalledWith([
      "https://stream.mux.com/playback-id.m3u8",
      "https://stream.mux.com/second-id.m3u8",
    ]);
    expect(result.current.candidates).toHaveLength(0);
  });

  it("warms current media before current-item, nearby, and remaining service media", async () => {
    const sources = ["current", "current-item", "nearby", "remaining"];
    const ensureMediaCached = jest.fn().mockResolvedValue({
      requested: 4,
      cacheable: 4,
      downloaded: 4,
      failed: 0,
      cacheMap: {},
    });
    const docs = sources.slice(1).map((name, index) =>
      item(`item-${index + 1}`, name, [
        slide(`slide-${index + 1}`, [
          {
            id: name,
            mediaInfo: video(name, `https://stream.mux.com/${name}.m3u8`),
          },
        ]),
      ]),
    );

    renderCandidates(docs, {
      currentItemId: "item-1",
      currentMedia: {
        mediaKey: "remote:current",
        source: "https://stream.mux.com/current.m3u8",
      },
      ensureMediaCached,
      getLocalMediaPath: jest.fn().mockResolvedValue(null),
    });

    await waitFor(() => expect(ensureMediaCached).toHaveBeenCalledTimes(1));
    expect(ensureMediaCached).toHaveBeenCalledWith([
      "https://stream.mux.com/current.m3u8",
      "https://stream.mux.com/current-item.m3u8",
      "https://stream.mux.com/nearby.m3u8",
      "https://stream.mux.com/remaining.m3u8",
    ]);
  });

  it("keeps an uncached finite MP4 eligible while warming its additive cache", async () => {
    const ensureMediaCached = jest.fn().mockResolvedValue({
      requested: 1,
      cacheable: 1,
      downloaded: 1,
      failed: 0,
      cacheMap: {},
    });
    const source = "https://cdn.example.com/finite.mp4";
    const { result } = renderCandidates(
      [
        item("item-1", "Finite video", [
          slide("slide-1", [
            { id: "finite", mediaInfo: video("finite", source) },
          ]),
        ]),
      ],
      {
        ensureMediaCached,
        getLocalMediaPath: jest.fn().mockResolvedValue(null),
      },
    );

    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    await waitFor(() =>
      expect(ensureMediaCached).toHaveBeenCalledWith([source]),
    );
    expect(result.current.diagnostics[0]).toMatchObject({
      status: "eligible",
      cacheStatus: "pending",
      reason: "finite video source available; cache warmup queued",
    });
  });

  it("keeps the service-wide candidate set when the current item changes", async () => {
    const docs = [
      item("item-1", "First", [
        slide("slide-1", [
          {
            id: "first",
            mediaInfo: video("first", "https://cdn.example.com/first.mp4"),
          },
        ]),
      ]),
      item("item-2", "Second", [
        slide("slide-2", [
          {
            id: "second",
            mediaInfo: video("second", "https://cdn.example.com/second.mp4"),
          },
        ]),
      ]),
    ];
    const { result, rerender, setCurrentItem } = renderCandidates(docs, {
      currentItemId: "item-1",
      maxSurfaces: 8,
    });

    await waitFor(() => expect(result.current.candidates).toHaveLength(2));
    const initialKeys = result.current.candidates.map(
      (candidate) => candidate.mediaKey,
    );
    setCurrentItem("item-2");
    rerender();
    await waitFor(() => expect(result.current.candidates).toHaveLength(2));
    expect(
      new Set(result.current.candidates.map((candidate) => candidate.mediaKey)),
    ).toEqual(new Set(initialKeys));
    expect(result.current.candidates[0].mediaKey).toBe("remote:second");
  });

  it("keeps the last service-wide candidate set when discovery temporarily fails", async () => {
    const docs = [
      item("item-1", "First", [
        slide("slide-1", [
          {
            id: "first",
            mediaInfo: video("first", "https://cdn.example.com/first.mp4"),
          },
        ]),
      ]),
      item("item-2", "Second", [
        slide("slide-2", [
          {
            id: "second",
            mediaInfo: video("second", "https://cdn.example.com/second.mp4"),
          },
        ]),
      ]),
    ];
    const { result, updater, db } = renderCandidates(docs, { maxSurfaces: 8 });

    await waitFor(() => expect(result.current.candidates).toHaveLength(2));
    db.get.mockRejectedValueOnce(new Error("temporary outline read failure"));
    await act(async () => {
      updater.dispatchEvent(
        new CustomEvent("update", { detail: [{ _id: "list-1" }] }),
      );
    });
    await act(async () => undefined);

    expect(
      result.current.candidates.map((candidate) => candidate.mediaKey),
    ).toEqual(["remote:first", "remote:second"]);
  });

  it("reads the explicitly resolved auxiliary outline instead of active presentation", async () => {
    const sanctuary = item("sanctuary", "Sanctuary", [
      slide("sanctuary-slide", [
        { id: "sanctuary-video", mediaInfo: video("sanctuary-video", "https://cdn.example.com/sanctuary.mp4") },
      ]),
    ]);
    const lobby = item("lobby", "Lobby", [
      slide("lobby-slide", [
        { id: "lobby-video", mediaInfo: video("lobby-video", "https://cdn.example.com/lobby.mp4") },
      ]),
    ]);
    const { result, db } = renderCandidates([sanctuary, lobby], {
      outlineId: "list-lobby",
      outlineItems: { "list-lobby": ["lobby"] },
    });

    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(result.current.candidates[0].mediaKey).toBe("remote:lobby-video");
    expect(db.get).toHaveBeenCalledWith("list-lobby");
    expect(db.get).not.toHaveBeenCalledWith("list-1");
  });

  it("does not warm the presentation outline when the output has no resolved scope outline", async () => {
    const ensureMediaCached = jest.fn();
    const sanctuary = item("sanctuary", "Sanctuary", [
      slide("sanctuary-slide", [
        { id: "sanctuary-video", mediaInfo: video("sanctuary-video", "https://cdn.example.com/sanctuary.mp4") },
      ]),
    ]);
    const { result, db } = renderCandidates([sanctuary], {
      outlineId: null,
      ensureMediaCached,
    });

    await act(async () => undefined);
    expect(result.current.candidates).toEqual([]);
    expect(db.get).not.toHaveBeenCalledWith("list-1");
    expect(ensureMediaCached).not.toHaveBeenCalled();
  });

  it("promotes a pending Mux video to an eligible media-cache candidate", async () => {
    const originalSource = "https://stream.mux.com/playback-id.m3u8";
    const getLocalMediaPath = jest.fn().mockResolvedValue(null);
    const ensureMediaCached = jest.fn().mockImplementation(async () => {
      return {
        requested: 1,
        cacheable: 1,
        downloaded: 1,
        failed: 0,
        cacheMap: { [originalSource]: "media-cache://playback-id.mp4" },
      };
    });
    const { result } = renderCandidates(
      [
        item("item-1", "Mux Song", [
          slide("slide-1", [
            { id: "mux", mediaInfo: video("mux", originalSource) },
          ]),
        ]),
      ],
      { getLocalMediaPath, ensureMediaCached },
    );

    await waitFor(() => expect(ensureMediaCached).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    expect(result.current.candidates[0]).toMatchObject({
      source: "media-cache://playback-id.mp4",
      mediaKey: "remote:mux",
    });
    expect(result.current.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "eligible",
          cacheStatus: "cached",
          resolvedSource: "media-cache://playback-id.mp4",
        }),
      ]),
    );
  });

  it("ignores a stale cache completion after the active service changes", async () => {
    let resolveEnsure: (() => void) | undefined;
    const ensureMediaCached = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveEnsure = () =>
            resolve({
              requested: 1,
              cacheable: 1,
              downloaded: 1,
              failed: 0,
              cacheMap: {},
            });
        }),
    );
    const oldDocs = [
      item("old", "Old", [
        slide("old-slide", [
          {
            id: "old-mux",
            mediaInfo: video("old-mux", "https://stream.mux.com/old.m3u8"),
          },
        ]),
      ]),
    ];
    const nextDocs = [
      item("new", "New", [
        slide("new-slide", [
          {
            id: "new-video",
            mediaInfo: video("new-video", "https://cdn.example.com/new.mp4"),
          },
        ]),
      ]),
    ];
    const { result, updater, replaceDocs } = renderCandidates(oldDocs, {
      ensureMediaCached,
      getLocalMediaPath: jest.fn().mockResolvedValue(null),
    });

    await waitFor(() => expect(ensureMediaCached).toHaveBeenCalledTimes(1));
    replaceDocs(nextDocs);
    await act(async () => {
      updater.dispatchEvent(
        new CustomEvent("update", { detail: [{ _id: "list-1" }] }),
      );
    });
    await waitFor(() =>
      expect(
        result.current.candidates.map((candidate) => candidate.mediaKey),
      ).toEqual(["remote:new-video"]),
    );

    resolveEnsure?.();
    await act(async () => undefined);
    expect(
      result.current.candidates.map((candidate) => candidate.mediaKey),
    ).toEqual(["remote:new-video"]);
  });

  it("deduplicates repeated media and includes every distinct video across items", async () => {
    const repeated = "https://cdn.example.com/repeated.mp4";
    const { result } = renderCandidates(
      [
        item("item-1", "First Song", [
          slide("slide-1", [{ id: "a", mediaInfo: video("repeat", repeated) }]),
          slide("slide-2", [{ id: "b", mediaInfo: video("repeat", repeated) }]),
        ]),
        item("item-2", "Second Song", [
          slide("slide-3", [
            {
              id: "c",
              mediaInfo: video("video-2", "https://cdn.example.com/two.mp4"),
            },
            {
              id: "d",
              mediaInfo: video("video-3", "https://cdn.example.com/three.mp4"),
            },
          ]),
        ]),
      ],
      { maxSurfaces: 10 },
    );

    await waitFor(() => expect(result.current.candidates).toHaveLength(3));
    expect(
      result.current.candidates.map((candidate) => candidate.mediaKey),
    ).toEqual(["remote:repeat", "remote:video-2", "remote:video-3"]);
    expect(result.current.diagnostics).toHaveLength(3);
  });

  it("uses the shared media identity and keeps ordering deterministic", async () => {
    const media = video("identity", "https://cdn.example.com/identity.mp4");
    const { result } = renderCandidates(
      [
        item("item-1", "First", [
          slide("slide-1", [
            { id: "b", mediaInfo: video("b", "https://cdn.example.com/b.mp4") },
          ]),
        ]),
        item("item-2", "Current", [
          slide("slide-2", [{ id: "a", mediaInfo: media }]),
        ]),
      ],
      {
        currentItemId: "item-2",
        currentMedia: {
          mediaKey: "remote:current",
          source: "https://cdn.example.com/current.mp4",
        },
        maxSurfaces: 3,
      },
    );

    await waitFor(() => expect(result.current.candidates).toHaveLength(3));
    const identityKey = getVideoBackgroundMediaKey(media) ?? "";
    expect(
      result.current.candidates.map((candidate) => candidate.mediaKey),
    ).toEqual(["remote:current", identityKey, "remote:b"]);
    expect(
      getLanePreparedMediaKey({
        kind: "fileVideo",
        mediaKey: identityKey,
        originalSrc: media.background,
        videoBox: {} as never,
      }),
    ).toBe(identityKey);
  });

  it("limits the Electron editor scope to videos in the current item", async () => {
    const { result } = renderCandidates(
      [
        item("item-1", "Other Song", [
          slide("slide-1", [
            { id: "other", mediaInfo: video("other", "https://cdn.example.com/other.mp4") },
          ]),
        ]),
        item("item-2", "Current Song", [
          slide("slide-2", [
            { id: "current-a", mediaInfo: video("current-a", "https://cdn.example.com/current-a.mp4") },
            { id: "current-b", mediaInfo: video("current-b", "https://cdn.example.com/current-b.mp4") },
          ]),
        ]),
      ],
      { currentItemId: "item-2", scope: "current-item", maxSurfaces: 8 },
    );

    await waitFor(() => expect(result.current.candidates).toHaveLength(2));
    expect(result.current.candidates.map((candidate) => candidate.mediaKey)).toEqual([
      "remote:current-a",
      "remote:current-b",
    ]);
  });
});
