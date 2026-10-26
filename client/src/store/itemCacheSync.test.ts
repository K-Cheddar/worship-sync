import { configureStore } from "@reduxjs/toolkit";
import allDocs from "./allDocsSlice";
import { startItemCacheSync } from "./itemCacheSync";

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
    changes: jest.fn(() => { const handle = createHandle(); handles.push(handle); return handle; }),
    put: jest.fn(), remove: jest.fn(),
  };
  return { db: db as unknown as PouchDB.Database, calls: db, handles };
};

describe("item cache lifecycle", () => {
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
    expect(dispatch).not.toHaveBeenCalled();
    handles[0].emit("change", { id: "preferences", seq: 6, deleted: true, doc: { _id: "preferences", _deleted: true } });
    expect(store.getState().allDocs).toBe(before);
    expect(store.getState().allDocs.changeVersion).toBe(0);
    stop();
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
