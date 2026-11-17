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

  it("restores legacy media after physical rollback and reactivates V2 without remounting", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const local = new PouchDB(`service-video-v2-rollback-local-${suffix}`);
    const remote = new PouchDB(`service-video-v2-rollback-remote-${suffix}`);
    const songId = "song/rollback-video";
    const legacy = {
      _id: songId,
      type: "song",
      name: "Legacy song",
      selectedArrangement: 0,
      arrangements: [{
        id: "master",
        name: "Master",
        formattedLyrics: [],
        songOrder: [],
        slides: [slide("legacy-slide", media("video-a", "https://cdn.example.com/video-a.mp4"))],
      }],
      slides: [],
    } as unknown as DBItem;
    const documents = serializeSongToV2Documents({
      _id: songId,
      type: "song",
      name: "Migrated song",
      selectedArrangement: 0,
      arrangements: [{
        id: "master",
        name: "Master",
        formattedLyrics: [],
        songOrder: [],
        slides: [slide("v2-slide", media("video-b", "https://cdn.example.com/video-b.mp4"))],
      }],
      slides: [],
    } as unknown as DBItem);
    const updater = new EventTarget();
    const feed = local.changes({ since: "now", live: true, include_docs: true });
    feed.on("change", (change) => {
      act(() => updater.dispatchEvent(new CustomEvent("update", {
        detail: [change.doc ?? { _id: change.id }],
      })));
    });
    const context = { db: local, updater } as unknown as ContextType<typeof ControllerInfoContext>;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={context}>{children}</ControllerInfoContext.Provider>
    );

    try {
      await remote.put(legacy as any);
      await remote.put({
        _id: "outline-rollback-video",
        docType: "itemListDetails",
        name: "Service",
        items: [{ _id: songId, listId: "song-row", name: "Song", type: "song" }],
        overlays: [],
      } as any);
      await remote.replicate.to(local);
      const { result } = renderHook(() => useServiceVideoCandidates({
        enabled: true,
        cacheMedia: false,
        outlineId: "outline-rollback-video",
      }), { wrapper });

      await waitFor(() => expect(result.current.candidates.map(candidate => candidate.source))
        .toContain("https://cdn.example.com/video-a.mp4"));

      await remote.put(documents.root as any);
      await remote.bulkDocs([...documents.arrangements, ...documents.slides] as any[]);
      await remote.replicate.to(local);
      await waitFor(() => expect(result.current.candidates.map(candidate => candidate.source))
        .toContain("https://cdn.example.com/video-b.mp4"));
      expect(result.current.candidates.map(candidate => candidate.source))
        .not.toContain("https://cdn.example.com/video-a.mp4");

      const liveRoot = await remote.get<typeof documents.root>(documents.root._id);
      await remote.put({ ...liveRoot, deletedAt: "2026-11-16T00:00:00.000Z" });
      await remote.replicate.to(local);
      await waitFor(() => expect(result.current.candidates).toEqual([]));
      expect(result.current.candidates.map(candidate => candidate.source))
        .not.toContain("https://cdn.example.com/video-a.mp4");

      const deletedRoot = await remote.get<typeof documents.root>(documents.root._id);
      const deletion = await remote.remove(deletedRoot);
      await remote.replicate.to(local);
      await waitFor(() => expect(result.current.candidates.map(candidate => candidate.source))
        .toContain("https://cdn.example.com/video-a.mp4"));
      expect(result.current.candidates.map(candidate => candidate.source))
        .not.toContain("https://cdn.example.com/video-b.mp4");

      const v2Slide = await remote.get<typeof documents.slides[number]>(documents.slides[0]._id);
      v2Slide.boxes[0].mediaInfo = media("video-c", "https://cdn.example.com/video-c.mp4");
      await remote.put(v2Slide as any);
      await remote.replicate.to(local);
      const reactivatedRoot = await remote.put({
        ...documents.root,
        _rev: deletion.rev,
        name: "Reactivated song",
      } as any);
      expect(reactivatedRoot.ok).toBe(true);
      await remote.replicate.to(local);
      await waitFor(() => expect(result.current.candidates.map(candidate => candidate.source))
        .toContain("https://cdn.example.com/video-c.mp4"));
      expect(result.current.candidates.map(candidate => candidate.source))
        .not.toContain("https://cdn.example.com/video-a.mp4");
    } finally {
      feed.cancel();
      await local.destroy();
      await remote.destroy();
    }
  });
});
