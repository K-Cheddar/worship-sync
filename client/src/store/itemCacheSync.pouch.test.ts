import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import { configureStore } from "@reduxjs/toolkit";
import { waitFor } from "@testing-library/react";
import allDocs from "./allDocsSlice";
import { startItemCacheSync } from "./itemCacheSync";
import type { DBItem } from "../types";
import { serializeSongToV2Documents } from "../utils/songPersistence";

describe("item cache with real local PouchDB and replication", () => {
  it("replays a write after an empty snapshot that omits update_seq", async () => {
    const local = new PouchDB(`cache-empty-gap-${Date.now()}`);
    const database = {
      allDocs: jest.fn(async () => {
        const snapshot = await local.allDocs({ include_docs: true, update_seq: true });
        expect(snapshot.rows).toHaveLength(0);
        await local.put({ _id: "first-write", type: "song", name: "Captured after empty snapshot" });
        // PouchDB's new-empty-database response may omit this property.
        return { rows: snapshot.rows };
      }),
      changes: local.changes.bind(local),
    };
    const store = configureStore({ reducer: { allDocs } });
    const stop = startItemCacheSync(database as unknown as PouchDB.Database, store.dispatch);
    try {
      await waitFor(() => expect(store.getState().allDocs.allSongDocs).toEqual([
        expect.objectContaining({
          _id: "first-write",
          name: "Captured after empty snapshot",
        }),
      ]));
      expect(database.allDocs).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      await local.destroy();
    }
  });

  it("replays real writes committed between the snapshot and live feed installation", async () => {
    const local = new PouchDB(`cache-gap-${Date.now()}`);
    await local.put({ _id: "song", type: "song", name: "Old" });
    await local.put({ _id: "deleted", type: "song", name: "Delete during loading" });
    const database = {
      allDocs: jest.fn(async () => {
        const snapshot = await local.allDocs({ include_docs: true, update_seq: true });
        await local.put({ ...await local.get("song"), name: "Updated during hydration" });
        await local.remove(await local.get("deleted"));
        await local.put({ _id: "created", type: "free", name: "Created during hydration" });
        return snapshot;
      }),
      changes: local.changes.bind(local),
    };
    const store = configureStore({ reducer: { allDocs } });
    const stop = startItemCacheSync(database as unknown as PouchDB.Database, store.dispatch);
    try {
      await waitFor(() => expect(store.getState().allDocs.allSongDocs.map((doc) => doc.name)).toEqual(["Updated during hydration"]));
      await waitFor(() => expect(store.getState().allDocs.allFreeFormDocs[0]?.name).toBe("Created during hydration"));
      expect(database.allDocs).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      await local.destroy();
    }
  });

  it("keeps concurrent caches current through local edits, offline writes, replication and deletes", async () => {
    const local = new PouchDB(`cache-local-${Date.now()}`);
    const remote = new PouchDB(`cache-remote-${Date.now()}`);
    const otherLocal = new PouchDB(local.name);
    const first = configureStore({ reducer: { allDocs } });
    const second = configureStore({ reducer: { allDocs } });
    const initial = { _id: "song", type: "song", name: "Original", background: "old", slides: [] };
    await local.put(initial);
    await local.put({ _id: "allItems", items: [{ _id: "index-only", name: "Historic", type: "song" }] });
    const historical = await local.get("allItems");
    const scan = jest.spyOn(local, "allDocs");
    const otherScan = jest.spyOn(otherLocal, "allDocs");
    const stopFirst = startItemCacheSync(local, first.dispatch);
    const stopSecond = startItemCacheSync(otherLocal, second.dispatch);
    try {
      await waitFor(() => expect(first.getState().allDocs.allSongDocs[0]?.name).toBe("Original"));
      await waitFor(() => expect(second.getState().allDocs.allSongDocs[0]?.name).toBe("Original"));
      const update = await local.get<DBItem>("song");
      await otherLocal.put({ ...update, name: "Renamed offline", background: "local-image://image" });
      await local.put({ _id: "custom", type: "free", name: "Custom", slides: [] });
      await local.put({ _id: "timer", type: "timer", name: "Timer" });
      await local.put({ _id: "bible", type: "bible", name: "John 3" });
      await local.put({ _id: "heading", type: "heading", name: "Worship" });
      await waitFor(() => expect(first.getState().allDocs.allFreeFormDocs[0]).toMatchObject({
        _id: "custom",
        name: "Custom",
        slides: [],
      }));
      await waitFor(() => expect(second.getState().allDocs.allFreeFormDocs[0]).toMatchObject({
        _id: "custom",
        name: "Custom",
        slides: [],
      }));
      await waitFor(() => expect(second.getState().allDocs.allSongDocs[0]).toMatchObject({ name: "Renamed offline", background: "local-image://image" }));
      await waitFor(() => expect(first.getState().allDocs.allHeadingDocs).toHaveLength(1));
      await waitFor(() => expect(second.getState().allDocs.allHeadingDocs).toHaveLength(1));
      const firstVersion = first.getState().allDocs.changeVersion;
      const secondVersion = second.getState().allDocs.changeVersion;
      await local.put({ _id: "outline", docType: "itemListDetails", items: [] });
      await local.put({ _id: "preferences", docType: "preferences" });
      await local.remove(await local.get("preferences"));
      await local.replicate.to(remote);
      expect(await remote.get("custom")).toMatchObject({
        name: "Custom",
        slides: [],
      });
      await remote.put({ _id: "overlay", docType: "overlay", type: "song", name: "Not an item" });
      const remoteSong = await remote.get<DBItem>("song");
      await remote.put({ ...remoteSong, name: "Remote rename", background: "remote background" });
      await local.replicate.from(remote);
      await waitFor(() => expect(first.getState().allDocs.allSongDocs[0]?.name).toBe("Remote rename"));
      await waitFor(() => expect(second.getState().allDocs.allSongDocs[0]?.background).toBe("remote background"));
      expect(first.getState().allDocs.changeVersion).toBe(firstVersion + 1);
      expect(second.getState().allDocs.changeVersion).toBe(secondVersion + 1);
      await remote.remove(await remote.get("song"));
      await local.replicate.from(remote);
      await waitFor(() => expect(first.getState().allDocs.allSongDocs).toEqual([]));
      await waitFor(() => expect(second.getState().allDocs.allSongDocs).toEqual([]));
      expect(scan).toHaveBeenCalledTimes(1);
      expect(otherScan).toHaveBeenCalledTimes(1); // Independent controller/database handles.
      expect(await local.get("allItems")).toEqual(historical);
      expect(first.getState().allDocs.allFreeFormDocs).toHaveLength(1);
      expect(first.getState().allDocs.allTimerDocs).toHaveLength(1);
      expect(first.getState().allDocs.allBibleDocs).toHaveLength(1);
      // Explicit deletion still persists and reaches both independent caches.
      await local.remove(await local.get("bible"));
      await local.remove(await local.get("heading"));
      await waitFor(() => expect(first.getState().allDocs.allBibleDocs).toEqual([]));
      await waitFor(() => expect(second.getState().allDocs.allHeadingDocs).toEqual([]));
      await expect(local.get("bible")).rejects.toMatchObject({ status: 404 });
      await expect(local.get("heading")).rejects.toMatchObject({ status: 404 });
    } finally {
      stopFirst();
      stopSecond();
      await local.destroy();
      await remote.destroy();
    }
  });

  it("refreshes Song V2 projections from replicated roots and arrangements without a Controller", async () => {
    const local = new PouchDB(`cache-song-v2-local-${Date.now()}`);
    const remote = new PouchDB(`cache-song-v2-remote-${Date.now()}`);
    const store = configureStore({ reducer: { allDocs } });
    const documents = serializeSongToV2Documents({
      _id: "song/live",
      type: "song",
      name: "V2 Live Song",
      selectedArrangement: 0,
      arrangements: [{
        id: "master",
        name: "Master",
        formattedLyrics: [{ words: "Initial lyric" }],
        songOrder: [],
        slides: [{ id: "slide-1", type: "Verse", name: "Verse 1", boxes: [] }],
      }],
      slides: [],
    } as unknown as DBItem);
    const scan = jest.spyOn(local, "allDocs");
    const stop = startItemCacheSync(local, store.dispatch);
    try {
      await remote.put({ _id: "song/live", type: "song", name: "Stale predecessor", slides: [] });
      await remote.replicate.to(local);
      await waitFor(() => expect(store.getState().allDocs.allSongDocs[0]?.name).toBe("Stale predecessor"));

      await remote.put(documents.root);
      await remote.replicate.to(local);
      await waitFor(() => expect(store.getState().allDocs.allSongDocs).toEqual([]));
      await waitFor(() => expect(store.getState().allDocs.songLibraryDiagnostics).toEqual([
        expect.objectContaining({ songId: "song/live", code: "incomplete-v2" }),
      ]));

      await remote.bulkDocs([...documents.arrangements, ...documents.slides]);
      await remote.replicate.to(local);
      await waitFor(() => expect(store.getState().allDocs.allSongDocs[0]?.arrangements?.[0]?.name).toBe("Master"));
      expect(store.getState().allDocs.songLibraryDiagnostics).toEqual([]);

      const arrangement = await remote.get<typeof documents.arrangements[number]>(documents.arrangements[0]._id);
      await remote.put({ ...arrangement, name: "Acoustic update" });
      await remote.replicate.to(local);
      await waitFor(() => expect(store.getState().allDocs.allSongDocs[0]?.arrangements?.[0]?.name).toBe("Acoustic update"));

      const allDocsCallsBeforeSlide = scan.mock.calls.length;
      const slide = await remote.get<typeof documents.slides[number]>(documents.slides[0]._id);
      const priorVersion = store.getState().allDocs.songContentVersions["song/live"] ?? 0;
      await remote.put({ ...slide, name: "Updated verse" });
      await remote.replicate.to(local);
      await waitFor(() => expect(store.getState().allDocs.songContentVersions["song/live"]).toBe(priorVersion + 1));
      expect(scan).toHaveBeenCalledTimes(allDocsCallsBeforeSlide);

      const root = await remote.get<typeof documents.root>(documents.root._id);
      await remote.put({ ...root, deletedAt: "2026-11-16T00:00:00.000Z" });
      await remote.replicate.to(local);
      await waitFor(() => expect(store.getState().allDocs.allSongDocs).toEqual([]));
      const legacy = await remote.get<DBItem>("song/live");
      await remote.put({ ...legacy, name: "Late legacy echo" });
      await remote.replicate.to(local);
      expect(store.getState().allDocs.allSongDocs).toEqual([]);
    } finally {
      stop();
      await local.destroy();
      await remote.destroy();
    }
  });

  it("converges when arrangements replicate before their Song V2 root", async () => {
    const local = new PouchDB(`cache-song-v2-child-first-local-${Date.now()}`);
    const remote = new PouchDB(`cache-song-v2-child-first-remote-${Date.now()}`);
    const store = configureStore({ reducer: { allDocs } });
    const documents = serializeSongToV2Documents({
      _id: "song/child-first",
      type: "song",
      name: "Child first song",
      selectedArrangement: 0,
      arrangements: [{
        id: "master",
        name: "Master",
        formattedLyrics: [],
        songOrder: [],
        slides: [{ id: "slide-1", type: "Verse", name: "Verse 1", boxes: [] }],
      }],
      slides: [],
    } as unknown as DBItem);
    const stop = startItemCacheSync(local, store.dispatch);
    try {
      await remote.put({ _id: "song/child-first", type: "song", name: "Legacy predecessor", slides: [] });
      await remote.replicate.to(local);
      await waitFor(() => expect(store.getState().allDocs.allSongDocs[0]?.name).toBe("Legacy predecessor"));

      await remote.bulkDocs([...documents.arrangements, ...documents.slides]);
      await remote.replicate.to(local);
      expect(store.getState().allDocs.allSongDocs[0]?.name).toBe("Legacy predecessor");

      await remote.put(documents.root);
      await remote.replicate.to(local);
      await waitFor(() => expect(store.getState().allDocs.allSongDocs[0]).toMatchObject({
        name: "Child first song",
        docType: "song-v2-root",
        arrangements: [expect.objectContaining({ id: "master", name: "Master" })],
      }));
      expect(store.getState().allDocs.songLibraryDiagnostics).toEqual([]);
    } finally {
      stop();
      await local.destroy();
      await remote.destroy();
    }
  });

  it("does not apply an old Song V2 refresh after the cache switches databases", async () => {
    const localA = new PouchDB(`cache-song-v2-switch-a-${Date.now()}`);
    const remoteA = new PouchDB(`cache-song-v2-switch-remote-${Date.now()}`);
    const localB = new PouchDB(`cache-song-v2-switch-b-${Date.now()}`);
    const store = configureStore({ reducer: { allDocs } });
    const songA = serializeSongToV2Documents({
      _id: "same-song-id",
      type: "song",
      name: "Church A song",
      selectedArrangement: 0,
      arrangements: [{ id: "master", name: "Master", formattedLyrics: [], songOrder: [], slides: [] }],
      slides: [],
    } as unknown as DBItem);
    await localB.put({ _id: "church-b-song", type: "song", name: "Church B song", slides: [] });

    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const originalGet = localA.get.bind(localA);
    const blockedRootRead = jest.spyOn(localA, "get").mockImplementation(async (id, options) => {
      if (id === songA.root._id) await readGate;
      return originalGet(id, options);
    });
    const stopA = startItemCacheSync(localA, store.dispatch);
    let stopB: (() => void) | undefined;
    try {
      await waitFor(() => expect(store.getState().allDocs.isInitialized).toBe(true));
      await remoteA.put(songA.root);
      await remoteA.replicate.to(localA);
      await waitFor(() => expect(blockedRootRead.mock.calls.some(([id]) => id === songA.root._id)).toBe(true));

      stopA();
      stopB = startItemCacheSync(localB, store.dispatch);
      await waitFor(() => expect(store.getState().allDocs.allSongDocs[0]?.name).toBe("Church B song"));

      releaseRead();
      await Promise.resolve();
      await Promise.resolve();
      expect(store.getState().allDocs.allSongDocs).toEqual([
        expect.objectContaining({ _id: "church-b-song", name: "Church B song" }),
      ]);
      expect(store.getState().allDocs.songLibraryDiagnostics).toEqual([]);
    } finally {
      releaseRead();
      blockedRootRead.mockRestore();
      stopA();
      stopB?.();
      await localA.destroy();
      await remoteA.destroy();
      await localB.destroy();
    }
  });
});
