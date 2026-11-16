import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ContextType, ReactNode } from "react";
import { ControllerInfoContext } from "../context/controllerInfo";
import type { DBItem, ItemSlideType, MediaType } from "../types";
import { serializeSongToV2Documents } from "../utils/songPersistence";
import { useServiceVideoCandidates } from "./useServiceVideoCandidates";

const media = (id: string, background: string) => ({
  id,
  type: "video",
  background,
} as unknown as MediaType);

const slide = (id: string, video: MediaType): ItemSlideType => ({
  id,
  name: id,
  type: "Media",
  boxes: [{ id: `${id}-box`, mediaInfo: video }],
} as ItemSlideType);

describe("service video preparation with physical Song V2 documents", () => {
  beforeEach(() => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { getLocalMediaPath: jest.fn().mockResolvedValue(null) },
    });
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("uses authoritative V2 slides, refreshes physical child changes, and ignores unrelated songs", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const local = new PouchDB(`service-video-v2-local-${suffix}`);
    const remote = new PouchDB(`service-video-v2-remote-${suffix}`);
    const songId = "song/video";
    const staleLegacy = {
      _id: songId,
      type: "song",
      name: "Legacy predecessor",
      selectedArrangement: 0,
      arrangements: [{
        id: "legacy-master",
        name: "Legacy master",
        formattedLyrics: [],
        songOrder: [],
        slides: [slide("legacy-slide", media("stale-video", "https://cdn.example.com/stale.mp4"))],
      }],
      slides: [],
    } as unknown as DBItem;
    const v2 = (targetSongId: string, background: string) => serializeSongToV2Documents({
      _id: targetSongId,
      type: "song",
      name: "Current V2 song",
      selectedArrangement: 0,
      arrangements: [{
        id: "master",
        name: "Master",
        formattedLyrics: [],
        songOrder: [],
        slides: [slide("v2-slide", media("v2-video", background))],
      }],
      slides: [],
    } as unknown as DBItem);
    const docs = v2(songId, "https://cdn.example.com/video-b.mp4");
    const updater = new EventTarget();
    let relayedChangeCount = 0;
    const feed = local.changes({ since: "now", live: true, include_docs: true });
    feed.on("change", (change) => {
      relayedChangeCount += 1;
      act(() => updater.dispatchEvent(new CustomEvent("update", {
        detail: [change.doc ?? { _id: change.id }],
      })));
    });
    const allDocs = jest.spyOn(local, "allDocs");
    const context = { db: local, updater } as unknown as ContextType<typeof ControllerInfoContext>;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={context}>{children}</ControllerInfoContext.Provider>
    );

    try {
      await local.put(staleLegacy as any);
      await local.put({
        _id: "outline-video",
        docType: "itemListDetails",
        name: "Service",
        items: [{ _id: songId, listId: "row-song", name: "Song", type: "song" }],
        overlays: [],
      } as any);
      const { result } = renderHook(() => useServiceVideoCandidates({
        enabled: true,
        cacheMedia: false,
        outlineId: "outline-video",
      }), { wrapper });

      await waitFor(() => expect(result.current.candidates.map(candidate => candidate.source))
        .toContain("https://cdn.example.com/stale.mp4"));

      await remote.put(docs.root as any);
      await remote.replicate.to(local);
      await waitFor(() => expect(result.current.candidates).toEqual([]));
      expect(result.current.discovery.missingItemIds).toContain(songId);

      await remote.bulkDocs([...docs.arrangements, ...docs.slides] as any[]);
      await remote.replicate.to(local);
      await waitFor(() => expect(result.current.candidates.map(candidate => candidate.source))
        .toContain("https://cdn.example.com/video-b.mp4"));
      expect(result.current.candidates.map(candidate => candidate.source))
        .not.toContain("https://cdn.example.com/stale.mp4");

      const changedSlide = await remote.get<typeof docs.slides[number]>(docs.slides[0]._id);
      changedSlide.boxes[0].mediaInfo = media("v2-video-c", "https://cdn.example.com/video-c.mp4");
      await remote.put(changedSlide as any);
      await remote.replicate.to(local);
      await waitFor(() => expect(result.current.candidates.map(candidate => candidate.source))
        .toContain("https://cdn.example.com/video-c.mp4"));
      expect(result.current.candidates.map(candidate => candidate.source))
        .not.toContain("https://cdn.example.com/video-b.mp4");

      const removedVideo = await remote.get<typeof docs.slides[number]>(docs.slides[0]._id);
      removedVideo.boxes[0].mediaInfo = { id: "still", type: "image", background: "https://cdn.example.com/still.jpg" } as any;
      await remote.put(removedVideo as any);
      await remote.replicate.to(local);
      await waitFor(() => expect(result.current.candidates).toEqual([]));

      const callsBeforeUnrelated = allDocs.mock.calls.length;
      const changesBeforeUnrelated = relayedChangeCount;
      const unrelated = v2("song/unrelated", "https://cdn.example.com/unrelated.mp4");
      await remote.bulkDocs([unrelated.root, ...unrelated.arrangements, ...unrelated.slides] as any[]);
      await remote.replicate.to(local);
      await waitFor(() => expect(relayedChangeCount).toBeGreaterThan(changesBeforeUnrelated));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
      expect(allDocs).toHaveBeenCalledTimes(callsBeforeUnrelated);
      expect(result.current.candidates).toEqual([]);
    } finally {
      feed.cancel();
      await local.destroy();
      await remote.destroy();
    }
  });
});
