import { configureStore } from "@reduxjs/toolkit";
import { waitFor } from "@testing-library/react";
import allDocs, { hydrateItemCache } from "./allDocsSlice";
import { flushItemCacheChanges, startItemCacheSync } from "./itemCacheSync";
import { serializeSongToV2Documents } from "../utils/songPersistence";

const song = (name = "Original", rev = "1-a") => ({ _id: "song", type: "song", name, _rev: rev, background: name });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const createDatabase = (snapshot: Promise<unknown>) => {
  type Handle = { cancel: jest.Mock; on: jest.Mock; emit: (name: string, event: unknown) => void };
  const handles: Handle[] = [];
  const createHandle = () => {
    const listeners = new Map<string, (event: any) => void>();
    const handle: Handle = {
      cancel: jest.fn(),
      on: jest.fn((name: string, listener: (event: any) => void) => { listeners.set(name, listener); return handle; }),
      emit: (name: string, event: unknown) => listeners.get(name)?.(event),
    };
    return handle;
  };
  const db = {
    allDocs: jest.fn().mockReturnValue(snapshot),
    get: jest.fn(),
    changes: jest.fn(() => { const handle = createHandle(); handles.push(handle); return handle; }),
    put: jest.fn(), remove: jest.fn(),
  };
  return { db: db as unknown as PouchDB.Database, calls: db, handles };
};

describe("item cache lifecycle", () => {
  it("hydrates a new empty IndexedDB database when its snapshot omits update_seq", async () => {
    const songDocument = { ...song("First local write"), _id: "first-local-write" };
    const { db, calls, handles } = createDatabase(Promise.resolve({ rows: [] }));
    const store = configureStore({ reducer: { allDocs } });
    const stop = startItemCacheSync(db, store.dispatch);

    await settle();

    expect(store.getState().allDocs.isInitialized).toBe(true);
    expect(calls.changes).toHaveBeenCalledWith({ since: 0, live: true, include_docs: true });
    handles[0].emit("change", { seq: 1, id: songDocument._id, doc: songDocument });
    await flushItemCacheChanges(db);
    expect(store.getState().allDocs.allSongDocs).toEqual([expect.objectContaining(songDocument)]);
    stop();
  });

  it("signals sequential startup only after the local snapshot has hydrated", async () => {
    const load = deferred<unknown>();
    const { db } = createDatabase(load.promise);
    const store = configureStore({ reducer: { allDocs } });
    const onHydrated = jest.fn();
    startItemCacheSync(db, store.dispatch, { onHydrated });

    expect(onHydrated).not.toHaveBeenCalled();
    load.resolve({ update_seq: 1, rows: [{ doc: song() }] });
    await settle();

    expect(store.getState().allDocs.isInitialized).toBe(true);
    expect(onHydrated).toHaveBeenCalledTimes(1);
  });

  it("hydrates item categories only and replays writes and tombstones from the snapshot sequence", async () => {
    const load = deferred<unknown>();
    const { db, calls, handles } = createDatabase(load.promise);
    const store = configureStore({ reducer: { allDocs } });
    const stop = startItemCacheSync(db, store.dispatch);
    expect(store.getState().allDocs.isInitialized).toBe(false);
    load.resolve({ update_seq: 7, rows: [
      ...[song(), { _id: "free", type: "free", name: "Custom" }, { _id: "timer", type: "timer", name: "Timer" },
        { _id: "bible", type: "bible", name: "Bible" }, { _id: "heading", type: "heading", name: "Heading" },
        { _id: "allItems", items: [{ _id: "index-only", type: "song", name: "Lost" }] },
        { _id: "overlay", docType: "overlay", type: "song", name: "Not an item" },
        { _id: "_design/items", type: "song", name: "Design" }].map((doc) => ({ doc })),
    ] });
    await settle();
    expect(calls.changes).toHaveBeenCalledWith({ since: 7, live: true, include_docs: true });
    expect(store.getState().allDocs).toMatchObject({
      isInitialized: true, allSongDocs: [song()], allHeadingDocs: [{ _id: "heading" }],
    });
    // These commits happened after the snapshot, before feed installation.
    handles[0].emit("change", { seq: 8, id: "song", doc: song("Renamed", "2-b") });
    handles[0].emit("change", { seq: 9, id: "free", deleted: true });
    handles[0].emit("change", { seq: 10, id: "new", doc: { ...song("Created"), _id: "new" } });
    await flushItemCacheChanges(db);
    expect(store.getState().allDocs.allSongDocs.map((doc) => doc.name)).toEqual(["Renamed", "Created"]);
    expect(store.getState().allDocs.allFreeFormDocs).toEqual([]);
    expect(calls.allDocs).toHaveBeenCalledTimes(1);
    expect(calls.put).not.toHaveBeenCalled();
    stop();
    expect(handles[0].cancel).toHaveBeenCalledTimes(1);
    expect(store.getState().allDocs.allSongDocs).toEqual([]);
  });

  it("ignores an old church snapshot and old live callbacks even when IDs and sequences repeat", async () => {
    const first = deferred<unknown>();
    const a = createDatabase(first.promise);
    const b = createDatabase(Promise.resolve({ update_seq: 1, rows: [{ doc: song("Church B") }] }));
    const store = configureStore({ reducer: { allDocs } });
    const stopA = startItemCacheSync(a.db, store.dispatch);
    stopA();
    const stopB = startItemCacheSync(b.db, store.dispatch);
    await settle();
    first.resolve({ update_seq: 999, rows: [{ doc: song("Church A") }] });
    await settle();
    expect(store.getState().allDocs.allSongDocs[0].name).toBe("Church B");
    expect(a.calls.changes).not.toHaveBeenCalled();
    stopB();
    b.handles[0].emit("change", { seq: 2, id: "song", doc: song("Late") });
    expect(store.getState().allDocs.allSongDocs).toEqual([]);
  });

  it("ignores unrelated live documents and uncached tombstones without changing the cache", async () => {
    const { db, handles } = createDatabase(Promise.resolve({ update_seq: 1, rows: [{ doc: song() }] }));
    const store = configureStore({ reducer: { allDocs } });
    const dispatch = jest.spyOn(store, "dispatch");
    const stop = startItemCacheSync(db, store.dispatch);
    await settle();
    const before = store.getState().allDocs;
    dispatch.mockClear();
    [
      { _id: "outline", docType: "itemListDetails", items: [] },
      { _id: "preferences", docType: "preferences", name: "Preferences" },
      { _id: "overlay", docType: "overlay", type: "song", name: "Overlay" },
      { _id: "config", docType: "configuration" },
    ].forEach((doc, index) => handles[0].emit("change", { id: doc._id, seq: index + 2, doc }));
    handles[0].emit("change", { id: "preferences", seq: 6, deleted: true, doc: { _id: "preferences", _deleted: true } });
    await flushItemCacheChanges(db);
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.getState().allDocs).toBe(before);
    expect(store.getState().allDocs.changeVersion).toBe(0);
    stop();
  });

  it("checks the current Redux cache before skipping a tombstone", async () => {
    const { db, handles } = createDatabase(Promise.resolve({ update_seq: 1, rows: [] }));
    const store = configureStore({ reducer: { allDocs } });
    const stop = startItemCacheSync(db, store.dispatch, {
      getCachedDocuments: () => {
        const cache = store.getState().allDocs;
        return [...cache.allSongDocs, ...cache.allFreeFormDocs, ...cache.allTimerDocs,
          ...cache.allBibleDocs, ...cache.allServiceTimeDocs, ...cache.allHeadingDocs];
      },
    });
    await settle();
    store.dispatch(hydrateItemCache([{ _id: "outside-write", type: "free", name: "Cached elsewhere" } as any]));
    handles[0].emit("change", { seq: 2, id: "outside-write", deleted: true });
    await flushItemCacheChanges(db);

    expect(store.getState().allDocs.allFreeFormDocs).toEqual([]);
    stop();
  });

  it("processes thousands of item, tombstone, and Song V2 events in bounded cache batches", async () => {
    const initial = Array.from({ length: 1000 }, (_, index) => ({
      _id: `item-${index}`,
      type: "free",
      name: `Item ${index}`,
      _rev: "1-a",
    }));
    const { db, handles } = createDatabase(Promise.resolve({
      update_seq: 1,
      rows: initial.map((doc) => ({ doc })),
    }));
    const store = configureStore({ reducer: { allDocs } });
    const dispatch = jest.spyOn(store, "dispatch");
    const stop = startItemCacheSync(db, store.dispatch);
    await settle();
    dispatch.mockClear();

    const changes = [
      ...Array.from({ length: 500 }, (_, index) => ({
        id: `item-${index}`,
        doc: { ...initial[index], name: `Updated ${index}`, _rev: "2-b" },
      })),
      ...Array.from({ length: 250 }, (_, index) => ({ id: `item-${index + 500}`, deleted: true })),
      ...Array.from({ length: 500 }, (_, index) => ({
        id: `new-${index}`,
        doc: { _id: `new-${index}`, type: "free", name: `New ${index}`, _rev: "1-a" },
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `song-v2:slide:song%2Flarge:master:slide%3A${index}`,
        doc: { docType: "song-v2-slide" },
      })),
    ];
    changes.forEach((change, index) => handles[0].emit("change", { ...change, seq: index + 2 }));
    await flushItemCacheChanges(db);

    const cacheBatches = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === "allDocs/applyItemDocumentChanges");
    expect(cacheBatches.length).toBeGreaterThan(0);
    expect(cacheBatches.length).toBeLessThan(changes.length / 10);
    expect(cacheBatches.every((action: any) => action.payload.length <= 128)).toBe(true);
    expect(store.getState().allDocs.allFreeFormDocs).toHaveLength(1250);
    expect(store.getState().allDocs.songContentVersions["song/large"]).toBe(1);
    stop();
  });

  it("coalesces superseded Song V2 projection reads for one logical song", async () => {
    const documents = serializeSongToV2Documents({
      _id: "song/coalesced",
      type: "song",
      name: "Coalesced song",
      selectedArrangement: 0,
      arrangements: [{ id: "master", name: "Master", formattedLyrics: [], songOrder: [], slides: [] }],
      slides: [],
    } as any);
    const snapshot = { update_seq: 1, rows: [{ doc: documents.root }, { doc: documents.arrangements[0] }] };
    const { db, calls, handles } = createDatabase(Promise.resolve(snapshot));
    const firstRootReadStarted = deferred<void>();
    const releaseFirstRootRead = deferred<void>();
    let rootReads = 0;
    calls.get.mockImplementation(async (id: string) => {
      if (id !== documents.root._id) throw Object.assign(new Error("missing root"), { status: 404 });
      rootReads += 1;
      if (rootReads === 1) {
        firstRootReadStarted.resolve();
        await releaseFirstRootRead.promise;
      }
      return documents.root;
    });
    calls.allDocs.mockImplementation((options: any) => {
      if (options?.keys) {
        return Promise.resolve({ rows: options.keys.map((id: string) => ({ id, doc: documents.arrangements[0] })) });
      }
      return Promise.resolve(snapshot);
    });
    const store = configureStore({ reducer: { allDocs } });
    const stop = startItemCacheSync(db, store.dispatch);
    try {
      await settle();
      handles[0].emit("change", { seq: 2, id: documents.arrangements[0]._id, doc: { ...documents.arrangements[0], _rev: "2-b" } });
      await firstRootReadStarted.promise;
      for (let index = 3; index < 103; index += 1) {
        handles[0].emit("change", {
          seq: index,
          id: documents.arrangements[0]._id,
          doc: { ...documents.arrangements[0], _rev: `${index}-c` },
        });
      }
      await flushItemCacheChanges(db);
      releaseFirstRootRead.resolve();
      await waitFor(() => expect(rootReads).toBe(2));
      await waitFor(() => expect(calls.allDocs.mock.calls.some(([options]) => Boolean((options as any)?.keys))).toBe(true));
      expect(rootReads).toBe(2);
      expect(store.getState().allDocs.allSongDocs[0]).toMatchObject({
        _id: "song/coalesced",
        docType: "song-v2-root",
      });
    } finally {
      releaseFirstRootRead.resolve();
      stop();
    }
  });

  it("resumes after feed failure without replacing newer documents or resurrecting deletions", async () => {
    jest.useFakeTimers();
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls, handles } = createDatabase(Promise.resolve({ update_seq: 1, rows: [{ doc: song() }] }));
    const store = configureStore({ reducer: { allDocs } });
    const stop = startItemCacheSync(db, store.dispatch);
    await settle();
    handles[0].emit("change", { seq: 2, id: "song", deleted: true });
    const afterDeletion = store.getState().allDocs;
    handles[0].emit("change", { seq: 3, id: "outline", doc: { _id: "outline", docType: "itemListDetails" } });
    expect(store.getState().allDocs).toBe(afterDeletion);
    handles[0].emit("error", new Error("connection interrupted"));
    await jest.advanceTimersByTimeAsync(1000);
    expect(calls.allDocs).toHaveBeenCalledTimes(1);
    expect(calls.changes).toHaveBeenLastCalledWith({ since: 3, live: true, include_docs: true });
    expect(store.getState().allDocs.allSongDocs).toEqual([]);
    handles[0].emit("change", { seq: 1, id: "song", doc: song("Obsolete feed") });
    expect(store.getState().allDocs.allSongDocs).toEqual([]);
    expect(store.getState().allDocs.error).toBeNull();
    stop();
    errorLog.mockRestore();
    jest.useRealTimers();
  });

  it("retries a failed snapshot and cancels retry work on session retirement", async () => {
    jest.useFakeTimers();
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = createDatabase(Promise.reject(new Error("database busy")));
    const store = configureStore({ reducer: { allDocs } });
    const stop = startItemCacheSync(db, store.dispatch);
    await settle();
    expect(store.getState().allDocs.isInitialized).toBe(false);
    expect(store.getState().allDocs.error).toBeTruthy();
    calls.allDocs.mockResolvedValue({ update_seq: 1, rows: [{ doc: song("Recovered") }] });
    await jest.advanceTimersByTimeAsync(1000);
    expect(store.getState().allDocs.allSongDocs[0].name).toBe("Recovered");
    stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(calls.allDocs).toHaveBeenCalledTimes(2);
    errorLog.mockRestore();
    jest.useRealTimers();
  });
});
