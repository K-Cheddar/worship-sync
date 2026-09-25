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

const heading = (id: string, name: string): DBItem =>
  ({ _id: id, name, type: "heading" }) as unknown as DBItem;

const itemWithoutSlides = (id: string, name: string): DBItem =>
  ({ _id: id, name, type: "song", slides: undefined }) as unknown as DBItem;

const renderCandidates = (
  docs: DBItem[],
  options: {
    currentItemId?: string;
    currentMedia?: { mediaKey: string; source: string };
    outlineId?: string | null;
    outlineItems?: Record<string, string[]>;
    maxSurfaces?: number;
    scope?: "service" | "current-item";
    renderer?: "projector" | "editor";
    cacheMap?: Record<string, string>;
    getLocalMediaPath?: jest.Mock;
    ensureMediaCached?: jest.Mock;
  } = {},
) => {
  const cacheMap = options.cacheMap ?? {};
  let currentDocs = docs;
  let selectedOutlineId = options.outlineId;
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
        outlineId: selectedOutlineId,
        maxSurfaces: options.maxSurfaces,
        scope: options.scope,
        renderer: options.renderer,
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
    setOutlineId: (nextOutlineId: string | null | undefined) => {
      selectedOutlineId = nextOutlineId;
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

  it("returns a bounded, deduplicated set of posters near the current item", async () => {
    const docs = [
      item("item-1", "One", [
        slide("slide-1", [
          { id: "a", mediaInfo: video("a", "https://cdn.example.com/a.mp4", { placeholderImage: "https://cdn.example.com/a.jpg" }) },
          { id: "b", mediaInfo: video("b", "https://cdn.example.com/b.mp4", { thumbnail: "https://cdn.example.com/b.jpg" }) },
        ]),
      ]),
      ...Array.from({ length: 5 }, (_, index) =>
        item(`item-${index + 2}`, `Song ${index + 2}`, [
          slide(`slide-${index + 2}`, [
            { id: `v-${index}`, mediaInfo: video(`v-${index}`, `https://cdn.example.com/v-${index}.mp4`, { thumbnail: `https://cdn.example.com/v-${index}.jpg` }) },
          ]),
        ]),
      ),
    ];
    const { result } = renderCandidates(docs, { currentItemId: "item-3" });
    await waitFor(() => expect(result.current.discovery.itemCount).toBe(6));
    expect(result.current.posterUrls).toHaveLength(7);
    expect(result.current.posterUrls[0]).toBe("https://cdn.example.com/v-1.jpg");
    expect(new Set(result.current.posterUrls).size).toBe(7);
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
          {
            id: "local-file",
            mediaInfo: video("local-file", "local-video-file://asset-1", {
              source: "local",
              localVideoFile: {
                id: "asset-1",
                ownerDeviceId: "device-1",
                ownerLabel: "Device 1",
                fileName: "asset.mp4",
                contentType: "video/mp4",
                storagePolicy: "local-only",
              },
            }),
          },
          {
            id: "canva",
            mediaInfo: video("canva", "https://cdn.example.com/canva.mp4", {
              canvaImportKey: "canva:design:rev:1:mp4:1",
              canvaSource: {
                designId: "design",
                designTitle: "Canva video",
                revision: 1,
                format: "mp4",
                pageNumbers: [1],
              },
            }),
          },
        ]),
      ]),
    ];
    const getLocalAsset = jest.fn().mockResolvedValue({
      url: "worshipsync-media://asset/asset-1/file.mp4",
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { getLocalAsset },
    });
    const { result } = renderCandidates(docs, { maxSurfaces: 8 });

    await waitFor(() => expect(result.current.candidates).toHaveLength(5));
    expect(new Set(result.current.candidates.map((candidate) => candidate.source))).toEqual(
      new Set([
        "worshipsync-media://asset/video.mp4",
        "media-cache://cached.mp4",
        "https://cdn.example.com/one.mp4",
        "worshipsync-media://asset/asset-1/file.mp4",
        "https://cdn.example.com/canva.mp4",
      ]),
    );
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

  it("makes an uncached Mux HLS attempt explicit instead of leaving it pending forever", async () => {
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

    await waitFor(() => expect(ensureMediaCached).toHaveBeenCalledTimes(3), {
      timeout: 4000,
    });
    expect(ensureMediaCached).toHaveBeenCalledWith([
      "https://stream.mux.com/playback-id.m3u8",
      "https://stream.mux.com/second-id.m3u8",
    ]);
    await waitFor(() =>
      expect(result.current.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mediaKey: "remote:mux",
            status: "excluded",
            cacheStatus: "unavailable",
          }),
        ]),
      ),
    );
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

    await waitFor(() =>
      expect(ensureMediaCached).toHaveBeenCalledWith([
        "https://stream.mux.com/current.m3u8",
        "https://stream.mux.com/current-item.m3u8",
        "https://stream.mux.com/nearby.m3u8",
        "https://stream.mux.com/remaining.m3u8",
      ]),
    );
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
      cacheStatus: "unavailable",
      reason: "finite cache unavailable; fallback-only",
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
    setCurrentItem("item-2");
    rerender();
    await waitFor(() => expect(result.current.candidates).toHaveLength(2));
    expect(new Set(result.current.candidates.map((candidate) => candidate.mediaKey))).toEqual(
      new Set(["remote:first", "remote:second"]),
    );
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
    expect(db.get).not.toHaveBeenCalledWith("ItemLists");
    expect(db.get).not.toHaveBeenCalledWith("list-1");
  });

  it("does not retain the old outline's candidates while the selected outline retries", async () => {
    const first = item("first", "First", [
      slide("first-slide", [
        { id: "first-video", mediaInfo: video("first-video", "https://cdn.example.com/first.mp4") },
      ]),
    ]);
    const second = item("second", "Second", [
      slide("second-slide", [
        { id: "second-video", mediaInfo: video("second-video", "https://cdn.example.com/second.mp4") },
      ]),
    ]);
    const { result, rerender, setOutlineId, db } = renderCandidates([first, second], {
      outlineId: "outline-a",
      outlineItems: { "outline-a": ["first"], "outline-b": ["second"] },
    });

    await waitFor(() => expect(result.current.candidates.map((candidate) => candidate.mediaKey)).toEqual(["remote:first-video"]));
    db.get.mockRejectedValueOnce(new Error("temporary outline read failure"));
    setOutlineId("outline-b");
    rerender();

    expect(result.current.candidates).toEqual([]);
    expect(result.current.discovery.targetOutlineId).toBe("outline-b");
    await waitFor(() => expect(result.current.candidates.map((candidate) => candidate.mediaKey)).toEqual(["remote:second-video"]));
    expect(result.current.discovery.loadedOutlineId).toBe("outline-b");
    expect(result.current.discovery.outlineLoadState).toBe("loaded");
  });

  it("retries a transient selected-outline read without becoming permanently empty", async () => {
    const first = item("first", "First", [
      slide("first-slide", [
        { id: "first-video", mediaInfo: video("first-video", "https://cdn.example.com/first.mp4") },
      ]),
    ]);
    const second = item("second", "Second", [
      slide("second-slide", [
        { id: "second-video", mediaInfo: video("second-video", "https://cdn.example.com/second.mp4") },
      ]),
    ]);
    const { result, rerender, setOutlineId, db } = renderCandidates([first, second], {
      outlineId: "outline-a",
      outlineItems: { "outline-a": ["first"], "outline-b": ["second"] },
    });

    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    db.get.mockRejectedValueOnce(new Error("temporary outline read failure"));
    setOutlineId("outline-b");
    rerender();

    await waitFor(() => expect(result.current.discovery.outlineLoadState).toBe("retrying"));
    await waitFor(() => expect(result.current.candidates.map((candidate) => candidate.mediaKey)).toEqual(["remote:second-video"]), { timeout: 2000 });
  });

  it("retries incomplete allDocs results after a replicated service item becomes available", async () => {
    const first = item("first", "First", [
      slide("first-slide", [
        { id: "first-video", mediaInfo: video("first-video", "https://cdn.example.com/first.mp4") },
      ]),
    ]);
    const second = item("second", "Second", [
      slide("second-slide", [
        { id: "second-video", mediaInfo: video("second-video", "https://cdn.example.com/second.mp4") },
      ]),
    ]);
    const { result, rerender, setOutlineId, db } = renderCandidates([first, second], {
      outlineId: "outline-a",
      outlineItems: { "outline-a": ["first"], "outline-b": ["second"] },
    });

    await waitFor(() => expect(result.current.candidates.map((candidate) => candidate.mediaKey)).toEqual(["remote:first-video"]));
    db.allDocs.mockResolvedValueOnce({ rows: [{ key: "second", error: "not_found" }] } as never);
    setOutlineId("outline-b");
    rerender();

    await waitFor(() => expect(result.current.discovery).toMatchObject({
      targetOutlineId: "outline-b",
      inventoryState: "incomplete",
      outlineLoadState: "retrying",
    }));
    await waitFor(() => expect(result.current.candidates.map((candidate) => candidate.mediaKey)).toEqual(["remote:second-video"]), { timeout: 2500 });
    expect(result.current.discovery).toMatchObject({
      inventoryState: "complete",
      outlineLoadState: "loaded",
      loadedOutlineId: "outline-b",
    });
  });

  it("reports a permanently missing replicated item without discarding discovered videos", async () => {
    jest.useFakeTimers();
    const first = item("first", "First", [
      slide("first-slide", [
        { id: "first-video", mediaInfo: video("first-video", "https://cdn.example.com/first.mp4") },
      ]),
    ]);
    const { result, db } = renderCandidates([first], {
      outlineId: "outline-a",
      outlineItems: { "outline-a": ["first", "lost"] },
    });
    db.allDocs.mockImplementation(async ({ keys }: { keys: string[] }) => ({
      rows: keys.map((key) => key === "first"
        ? { key, doc: first }
        : { key, error: "not_found" }),
    } as never));

    try {
      await act(async () => {
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(20_000);
      });
      expect(result.current.candidates.map((candidate) => candidate.mediaKey)).toEqual(["remote:first-video"]);
      expect(result.current.discovery).toMatchObject({
        inventoryState: "incomplete",
        outlineLoadState: "error",
        missingItemIds: ["lost"],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps usable media visible while reporting missing and invalid outline items", async () => {
    const first = item("first", "First", [
      slide("first-slide", [
        {
          id: "first-video",
          mediaInfo: video("first-video", "https://cdn.example.com/first.mp4"),
        },
      ]),
    ]);
    const second = item("second", "Second", [
      slide("second-slide", [
        {
          id: "second-video",
          mediaInfo: video(
            "second-video",
            "https://cdn.example.com/second.mp4",
          ),
        },
      ]),
    ]);
    const third = item("third", "Third", [
      slide("third-slide", [
        {
          id: "third-video",
          mediaInfo: video("third-video", "https://cdn.example.com/third.mp4"),
        },
      ]),
    ]);
    const { result, rerender, setOutlineId, db } = renderCandidates(
      [
        first,
        second,
        third,
        heading("heading-b", "Heading"),
        itemWithoutSlides("legacy-b", "Legacy item"),
      ],
      {
        outlineId: "outline-a",
        outlineItems: {
          "outline-a": ["first"],
          "outline-b": [
            "second",
            "heading-b",
            "third",
            "legacy-b",
            "missing-b",
          ],
        },
      },
    );

    await waitFor(() =>
      expect(
        result.current.candidates.map((candidate) => candidate.mediaKey),
      ).toEqual(["remote:first-video"]),
    );
    setOutlineId("outline-b");
    rerender();

    await waitFor(() =>
      expect(
        result.current.candidates.map((candidate) => candidate.mediaKey),
      ).toEqual(["remote:second-video", "remote:third-video"]),
    );
    expect(
      result.current.discovery.items.map((entry) => ({
        itemId: entry.itemId,
        itemIndex: entry.itemIndex,
      })),
    ).toEqual([
      { itemId: "second", itemIndex: 0 },
      { itemId: "third", itemIndex: 2 },
    ]);
    expect(result.current.discovery).toMatchObject({
      itemCount: 2,
      targetOutlineId: "outline-b",
      loadedOutlineId: "outline-a",
      outlineLoadState: "error",
      inventoryState: "invalid",
      outlineRetryAttempt: 0,
    });
    expect(result.current.discovery.outlineLoadError).toContain("invalid");
    expect(db.allDocs).toHaveBeenLastCalledWith({
      keys: ["second", "heading-b", "third", "legacy-b", "missing-b"],
      include_docs: true,
    });
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

  it("discovers the same complete service video set for projector and editor", async () => {
    const videoOne = "https://cdn.example.com/video-1.mp4";
    const docs = [
      item("item-a", "Song A", [
        slide("slide-a", [{ id: "video-1-a", mediaInfo: video("video-1", videoOne) }]),
      ]),
      item("item-b", "Song B", [
        slide("slide-b", [{ id: "video-2-b", mediaInfo: video("video-2", "https://cdn.example.com/video-2.mp4") }]),
      ]),
      item("item-c", "Song C", [
        slide("slide-c", [{ id: "video-3-c", mediaInfo: video("video-3", "https://cdn.example.com/video-3.mp4") }]),
      ]),
      item("item-d", "Song D", [
        slide("slide-d", [{ id: "video-1-d", mediaInfo: video("video-1", videoOne) }]),
      ]),
    ];

    const {
      result: projectorResult,
      unmount: unmountProjector,
    } = renderCandidates(docs, {
      currentItemId: "item-a",
      renderer: "projector",
    });
    await waitFor(() => expect(projectorResult.current.candidates).toHaveLength(3));
    expect(projectorResult.current.discovery).toMatchObject({
      renderer: "projector",
      itemCount: 4,
      uniqueFiniteVideoCount: 3,
    });
    expect(projectorResult.current.discovery.items).toHaveLength(4);
    expect(
      projectorResult.current.diagnostics
        .filter((diagnostic) => diagnostic.isCurrentItem)
        .map((diagnostic) => diagnostic.mediaKey),
    ).toEqual(["remote:video-1"]);
    unmountProjector();

    const { result: editorResult } = renderCandidates(docs, {
      currentItemId: "item-a",
      renderer: "editor",
    });
    await waitFor(() => expect(editorResult.current.candidates).toHaveLength(3));
    expect(editorResult.current.discovery).toMatchObject({
      renderer: "editor",
      itemCount: 4,
      uniqueFiniteVideoCount: 3,
    });
    expect(editorResult.current.discovery.items.map((entry) => entry.itemName)).toEqual([
      "Song A",
      "Song B",
      "Song C",
      "Song D",
    ]);
  });

  it("supports an explicit current-item scope for generic callers", async () => {
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
