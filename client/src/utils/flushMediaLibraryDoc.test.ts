import {
  FLUSH_MEDIA_NO_DB_MESSAGE,
  FLUSH_MEDIA_STALE_DB_MESSAGE,
  deleteMediaItemAtRevisionFromPouch,
  deleteMediaItemsFromPouch,
  flushMediaLibraryDocToPouch,
} from "./flushMediaLibraryDoc";
import { loadMediaLibrary } from "./mediaDocUtils";
import type { MediaItemDoc } from "./mediaDocUtils";
import { deleteFolderAndSubtree } from "./mediaFolderMutations";
import type { MediaType } from "../types";

let mockGlobalDb: PouchDB.Database | undefined;
let mockBroadcastRef: { postMessage: jest.Mock } | null;
let mockDispatch: jest.Mock;

jest.mock("../context/controllerInfo", () => ({
  get globalDb() {
    return mockGlobalDb;
  },
  get globalBroadcastRef() {
    return mockBroadcastRef;
  },
}));

jest.mock("../store/store", () => ({
  __esModule: true,
  default: { dispatch: (...args: unknown[]) => mockDispatch(...args) },
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};

describe("flushMediaLibraryDocToPouch", () => {
  beforeEach(() => {
    mockGlobalDb = undefined;
    mockBroadcastRef = null;
    mockDispatch = jest.fn();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("returns ok: false with a clear error when db is unavailable", async () => {
    const r = await flushMediaLibraryDocToPouch(undefined, [], []);
    expect(r).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: FLUSH_MEDIA_NO_DB_MESSAGE,
      }),
    });
  });

  it("finishes a captured owner's folder write after a switch without publishing into the new scope", async () => {
    const dbA = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        throw Object.assign(new Error("missing"), { status: 404 });
      }),
      allDocs: jest.fn().mockResolvedValue({ rows: [] }),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-folder" }),
    } as unknown as PouchDB.Database;
    const dbB = {} as PouchDB.Database;
    mockGlobalDb = dbB;
    mockBroadcastRef = { postMessage: jest.fn() };

    const result = await flushMediaLibraryDocToPouch(
      dbA,
      [],
      [{ id: "folder-a", name: "A folder", parentId: null, createdAt: "now", updatedAt: "now" }],
      () => ({ list: [], folders: [{ id: "folder-a", name: "A folder", parentId: null, createdAt: "now", updatedAt: "now" }] }),
      { list: [], folders: [] },
      {
        allowOriginalOwnerPersistenceAfterScopeChange: true,
        publishIfCurrent: () => false,
      },
    );

    expect(result).toEqual({ ok: true });
    expect(dbA.put).toHaveBeenCalledWith(expect.objectContaining({
      _id: "media-folders",
      folders: [{ id: "folder-a", name: "A folder", parentId: null, createdAt: "now", updatedAt: "now" }],
    }));
    expect(mockBroadcastRef.postMessage).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("writes only v2 documents through the database instance supplied by the caller", async () => {
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        if (id === "media-folders") throw Object.assign(new Error("missing"), { status: 404 });
        throw Object.assign(new Error("missing"), { status: 404 });
      }),
      allDocs: jest.fn().mockResolvedValue({ rows: [] }),
      put: jest.fn().mockResolvedValue({
        ok: true,
        id: "media-item:media-1",
        rev: "1-item",
      }),
      remove: jest.fn(),
    } as unknown as PouchDB.Database;
    const list = [
      {
        id: "media-1",
        name: "Kept media",
        path: "",
        createdAt: "",
        updatedAt: "",
        format: "",
        height: 0,
        width: 0,
        publicId: "media-1",
        type: "image" as const,
        background: "",
        thumbnail: "",
      },
    ] satisfies MediaType[];
    mockGlobalDb = db;

    const result = await flushMediaLibraryDocToPouch(db, list, []);

    expect(result).toEqual({ ok: true });
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({
      _id: "media-item:media-1",
      id: "media-1",
      docType: "mediaItem",
    }));
    expect(db.put).not.toHaveBeenCalledWith(expect.objectContaining({ _id: "media" }));
  });

  it("tombstones known media item documents and broadcasts item deletes", async () => {
    const row = {
      _id: "media-item:delete-me",
      _rev: "2-latest",
      docType: "mediaItem",
      id: "delete-me",
    };
    const docs = new Map([[row._id, row]]);
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        const doc = docs.get(id);
        if (!doc) throw Object.assign(new Error("missing"), { status: 404 });
        return doc;
      }),
      remove: jest.fn(async (doc: typeof row) => {
        docs.delete(doc._id);
        return { ok: true, id: doc._id };
      }),
      allDocs: jest.fn(async () => ({ rows: [...docs.values()].map((doc) => ({ id: doc._id, doc })) })),
    } as unknown as PouchDB.Database;
    mockGlobalDb = db;
    mockBroadcastRef = { postMessage: jest.fn() };

    const result = await deleteMediaItemsFromPouch(db, ["delete-me"]);

    expect(result).toEqual({ deletedIds: ["delete-me"], failed: [] });
    expect(db.remove).toHaveBeenCalledWith(row);
    expect(docs.has(row._id)).toBe(false);
    await expect(loadMediaLibrary(db)).resolves.toEqual({ list: [], folders: [] });
    expect(mockBroadcastRef.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "update",
      data: expect.objectContaining({
        docs: [{ _id: row._id, id: "delete-me", _deleted: true }],
      }),
    }));
  });

  it("keeps a bulk tombstone successful when its remove commits before a scope switch", async () => {
    const removeStarted = deferred<void>();
    const finishRemove = deferred<PouchDB.Core.Response>();
    const row = {
      _id: "media-item:delete-me",
      _rev: "2-latest",
      docType: "mediaItem",
      id: "delete-me",
    };
    const dbA = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        return row;
      }),
      remove: jest.fn(() => {
        removeStarted.resolve();
        return finishRemove.promise;
      }),
    } as unknown as PouchDB.Database;
    const dbB = {} as PouchDB.Database;
    const churchABroadcast = { postMessage: jest.fn() };
    const churchBBroadcast = { postMessage: jest.fn() };
    mockGlobalDb = dbA;
    mockBroadcastRef = churchABroadcast;

    const deletion = deleteMediaItemsFromPouch(dbA, [row.id]);
    await removeStarted.promise;
    expect(dbA.remove).toHaveBeenCalledWith(row);
    mockGlobalDb = dbB;
    mockBroadcastRef = churchBBroadcast;
    finishRemove.resolve({ ok: true, id: row._id, rev: "3-deleted" });

    await expect(deletion).resolves.toEqual({ deletedIds: [row.id], failed: [] });
    expect(dbA.remove).toHaveBeenCalledTimes(1);
    expect(churchABroadcast.postMessage).not.toHaveBeenCalled();
    expect(churchBBroadcast.postMessage).not.toHaveBeenCalled();
  });

  it("keeps a committed tombstone successful after the active database changes", async () => {
    const removeStarted = deferred<void>();
    const finishRemove = deferred<PouchDB.Core.Response>();
    const doc = {
      _id: "media-item:delete-me",
      _rev: "2-latest",
      docType: "mediaItem",
      id: "delete-me",
    };
    const dbA = {
      remove: jest.fn(() => {
        removeStarted.resolve();
        return finishRemove.promise;
      }),
    } as unknown as PouchDB.Database;
    const dbB = {} as PouchDB.Database;
    const churchABroadcast = { postMessage: jest.fn() };
    const churchBBroadcast = { postMessage: jest.fn() };
    mockGlobalDb = dbA;
    mockBroadcastRef = churchABroadcast;

    const deletion = deleteMediaItemAtRevisionFromPouch(dbA, doc as MediaItemDoc);
    await removeStarted.promise;
    mockGlobalDb = dbB;
    mockBroadcastRef = churchBBroadcast;
    finishRemove.resolve({ ok: true, id: doc._id, rev: "3-deleted" });

    await expect(deletion).resolves.toBe("deleted");
    expect(dbA.remove).toHaveBeenCalledWith(doc);
    expect(churchABroadcast.postMessage).not.toHaveBeenCalled();
    expect(churchBBroadcast.postMessage).not.toHaveBeenCalled();
  });

  it("uses item tombstones for every media row in a deleted folder subtree", async () => {
    const folders = [
      { id: "parent", name: "Parent", parentId: null },
      { id: "child", name: "Child", parentId: "parent" },
    ] as any;
    const list = [
      { id: "parent-row", folderId: "parent" },
      { id: "child-row", folderId: "child" },
      { id: "keep-row", folderId: null },
    ] as any;
    const subtreeDelete = deleteFolderAndSubtree("parent", folders, list);
    const rows = new Map<string, { _id: string; _rev: string; docType: string; id: string }>(
      list.map((item: { id: string }) => [`media-item:${item.id}`, {
        _id: `media-item:${item.id}`,
        _rev: "1-current",
        docType: "mediaItem",
        id: item.id,
      }]),
    );
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        const doc = rows.get(id);
        if (!doc) throw Object.assign(new Error("missing"), { status: 404 });
        return doc;
      }),
      remove: jest.fn(async (doc: { _id: string }) => {
        rows.delete(doc._id);
        return { ok: true, id: doc._id };
      }),
      allDocs: jest.fn(async () => ({ rows: [...rows.values()].map((doc) => ({ id: doc._id, doc })) })),
    } as unknown as PouchDB.Database;
    mockGlobalDb = db;

    const result = await deleteMediaItemsFromPouch(db, subtreeDelete.removedMediaIds);

    expect(result.deletedIds).toEqual(["parent-row", "child-row"]);
    expect(db.remove).toHaveBeenCalledTimes(2);
    expect(rows.has("media-item:parent-row")).toBe(false);
    expect(rows.has("media-item:child-row")).toBe(false);
    expect(rows.has("media-item:keep-row")).toBe(true);
  });

  it("uses the latest state when a Canva save reaches the Pouch write", async () => {
    const startingMedia = [{ id: "canva-page", name: "Old page" }] as MediaType[];
    let latestMedia = startingMedia;
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        if (id === "media-folders") throw Object.assign(new Error("missing"), { status: 404 });
        throw Object.assign(new Error("missing"), { status: 404 });
      }),
      allDocs: jest.fn().mockResolvedValue({ rows: [] }),
      put: jest.fn().mockResolvedValue({ ok: true, id: "media-item:canva-page", rev: "2-item" }),
      remove: jest.fn(),
    } as unknown as PouchDB.Database;
    mockGlobalDb = db;

    const getLatestState = jest.fn(() => {
      latestMedia = [
        { id: "canva-page", name: "Newer page revision" } as MediaType,
        { id: "ordinary-upload", name: "Concurrent upload" } as MediaType,
      ];
      return { list: latestMedia, folders: [] };
    });
    const result = await flushMediaLibraryDocToPouch(db, startingMedia, [], getLatestState);

    expect(result).toEqual({ ok: true });
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: "media-item:canva-page", name: "Newer page revision" }));
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: "media-item:ordinary-upload" }));
    expect(db.put).not.toHaveBeenCalledWith(expect.objectContaining({ _id: "media" }));
  });

  it("merges folder finalization with the latest Pouch items without resurrecting remote deletions", async () => {
    const media = (id: string, name: string, folderId: string | null): MediaType => ({
      id, name, folderId: folderId || undefined, type: "image", path: "", createdAt: "", updatedAt: "",
      format: "", height: 0, width: 0, publicId: id, background: "", thumbnail: "",
    });
    const stableBefore = media("stable", "Original", "folder");
    const targetBefore = media("already-tombstoned", "Target", "folder");
    const remotelyDeletedBefore = media("deleted-remotely", "Remote deletion", "folder");
    const reduxStable = media("stable", "Redux snapshot", null);
    const reduxAddition = media("concurrent-addition", "Older Redux copy", null);
    const reduxRemoteDelete = media("deleted-remotely", "Remote deletion", null);
    const concurrentFolder = {
      id: "concurrent-folder", name: "Concurrent folder", parentId: null, createdAt: "now", updatedAt: "now",
    };
    const persisted = new Map<string, Record<string, unknown>>([
      ["media-library-meta", { _id: "media-library-meta", docType: "mediaLibraryMeta", schemaVersion: 2 }],
      ["media-folders", {
        _id: "media-folders", docType: "mediaFolders", folders: [
          { id: "folder", name: "Deleted folder", parentId: null }, { ...concurrentFolder, parentId: "folder" },
        ],
      }],
      ["media-item:stable", { ...media("stable", "Pouch newer name", "folder"), _id: "media-item:stable", docType: "mediaItem" }],
      ["media-item:concurrent-addition", { ...media("concurrent-addition", "Pouch latest addition", "folder"), _id: "media-item:concurrent-addition", docType: "mediaItem" }],
    ]);
    const db = {
      get: jest.fn(async (id: string) => {
        const doc = persisted.get(id);
        if (doc) return { ...doc };
        throw Object.assign(new Error("missing"), { status: 404 });
      }),
      allDocs: jest.fn(async () => ({ rows: [...persisted.entries()]
        .filter(([id]) => id.startsWith("media-item:"))
        .map(([id, doc]) => ({ id, doc: { ...doc } })) })),
      put: jest.fn(async (doc: Record<string, unknown>) => {
        persisted.set(String(doc._id), { ...doc });
        return { ok: true, id: doc._id, rev: "2-current" };
      }),
      remove: jest.fn(async (doc: Record<string, unknown>) => {
        persisted.delete(String(doc._id));
        return { ok: true, id: doc._id };
      }),
    } as unknown as PouchDB.Database;
    mockGlobalDb = db;

    const result = await flushMediaLibraryDocToPouch(
      db,
      [reduxStable, reduxAddition, reduxRemoteDelete],
      [concurrentFolder],
      () => ({ list: [reduxStable, reduxAddition, reduxRemoteDelete], folders: [concurrentFolder] }),
      {
        list: [stableBefore, targetBefore, remotelyDeletedBefore],
        folders: [{ id: "folder", name: "Deleted folder", parentId: null, createdAt: "now", updatedAt: "now" }],
      },
    );

    expect(result).toEqual({ ok: true });
    expect(persisted.get("media-item:stable")).toEqual(expect.objectContaining({
      name: "Pouch newer name",
      folderId: null,
    }));
    expect(persisted.get("media-item:concurrent-addition")).toEqual(expect.objectContaining({
      name: "Pouch latest addition",
      folderId: null,
    }));
    expect(persisted.has("media-item:already-tombstoned")).toBe(false);
    expect(persisted.has("media-item:deleted-remotely")).toBe(false);
    expect(persisted.get("media-folders")).toEqual(expect.objectContaining({ folders: [concurrentFolder] }));
  });

  it("does not write when the supplied database is no longer active", async () => {
    const staleDb = {
      get: jest.fn(),
      put: jest.fn(),
    } as unknown as PouchDB.Database;
    mockGlobalDb = {} as PouchDB.Database;

    const result = await flushMediaLibraryDocToPouch(staleDb, [], []);

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: FLUSH_MEDIA_STALE_DB_MESSAGE,
      }),
    });
    expect(staleDb.get).not.toHaveBeenCalled();
    expect(staleDb.put).not.toHaveBeenCalled();
  });

  it("fails closed without schema v2 and never creates the legacy aggregate", async () => {
    const postMessage = jest.fn();
    const syncMediaCache = jest.fn().mockResolvedValue({ downloaded: 0, cleaned: 0 });
    const getMediaCacheMap = jest.fn().mockResolvedValue({});
    mockBroadcastRef = { postMessage };
    const db = {
      get: jest.fn((id: string) => {
        if (id === "media-library-meta") {
          return Promise.reject(Object.assign(new Error("missing"), { status: 404 }));
        }
        return Promise.reject(Object.assign(new Error("missing"), { status: 404 }));
      }),
      put: jest.fn(),
      remove: jest.fn(),
      allDocs: jest.fn(),
    } as unknown as PouchDB.Database;
    mockGlobalDb = db;
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      syncMediaCache,
      getMediaCacheMap,
    };

    const getLatestState = jest.fn(() => ({
      list: [{ id: "from-church-b", name: "B" } as MediaType],
      folders: [],
    }));
    const flush = flushMediaLibraryDocToPouch(
      db,
      [{ id: "from-church-a", name: "A" } as MediaType],
      [],
      getLatestState,
    );
    await expect(flush).resolves.toEqual({ ok: false, error: expect.any(Error) });
    expect(db.put).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(getLatestState).not.toHaveBeenCalled();
    expect(syncMediaCache).not.toHaveBeenCalled();
    expect(getMediaCacheMap).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("stops the v2 item reconciliation after a deferred database read becomes stale", async () => {
    const itemRead = deferred<{ rows: Array<{ id: string; doc: Record<string, unknown> }> }>();
    const itemReadStarted = deferred<void>();
    const postMessage = jest.fn();
    const syncMediaCache = jest.fn().mockResolvedValue({ downloaded: 0, cleaned: 0 });
    const getMediaCacheMap = jest.fn().mockResolvedValue({});
    mockBroadcastRef = { postMessage };
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        if (id === "media-folders") return { _id: id, folders: [] };
        throw Object.assign(new Error("missing"), { status: 404 });
      }),
      allDocs: jest.fn(() => {
        itemReadStarted.resolve();
        return itemRead.promise;
      }),
      put: jest.fn(),
      remove: jest.fn(),
    } as unknown as PouchDB.Database;
    mockGlobalDb = db;
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      syncMediaCache,
      getMediaCacheMap,
    };

    const flush = flushMediaLibraryDocToPouch(db, [{ id: "from-church-a", name: "A" } as MediaType], []);
    await itemReadStarted.promise;
    mockGlobalDb = {} as PouchDB.Database;
    itemRead.resolve({
      rows: [{ id: "media-item:from-church-a", doc: { _id: "media-item:from-church-a", id: "from-church-a", docType: "mediaItem" } }],
    });

    await expect(flush).resolves.toEqual({ ok: true });
    expect(db.put).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(syncMediaCache).not.toHaveBeenCalled();
    expect(getMediaCacheMap).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
