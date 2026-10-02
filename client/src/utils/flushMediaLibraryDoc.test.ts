import {
  FLUSH_MEDIA_NO_DB_MESSAGE,
  FLUSH_MEDIA_STALE_DB_MESSAGE,
  flushMediaLibraryDocToPouch,
} from "./flushMediaLibraryDoc";
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

  it("writes only through the database instance supplied by the caller", async () => {
    const db = {
      get: jest.fn().mockResolvedValue({
        _id: "media",
        _rev: "1-media",
        list: [],
        folders: [],
      }),
      put: jest.fn().mockResolvedValue({
        ok: true,
        id: "media",
        rev: "2-media",
      }),
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
    expect(db.get).toHaveBeenCalledWith("media");
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "media",
        _rev: "1-media",
        list,
        folders: [],
        updatedAt: expect.any(String),
      }),
    );
  });

  it("uses the latest state when a Canva save reaches the Pouch write", async () => {
    const startingMedia = [{ id: "canva-page", name: "Old page" }] as MediaType[];
    let latestMedia = startingMedia;
    const db = {
      get: jest.fn().mockImplementation(async () => {
        latestMedia = [
          { id: "canva-page", name: "Newer page revision" } as MediaType,
          { id: "ordinary-upload", name: "Concurrent upload" } as MediaType,
        ];
        return { _id: "media", _rev: "1-media", list: [], folders: [] };
      }),
      put: jest.fn().mockResolvedValue({ ok: true, id: "media", rev: "2-media" }),
    } as unknown as PouchDB.Database;
    mockGlobalDb = db;

    const result = await flushMediaLibraryDocToPouch(db, startingMedia, [], () => ({ list: latestMedia, folders: [] }));

    expect(result).toEqual({ ok: true });
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ list: latestMedia }));
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

  it("stops the v1 aggregate flush after an async read becomes stale", async () => {
    const mediaRead = deferred<{ _id: string; _rev: string; list: MediaType[]; folders: [] }>();
    const mediaReadStarted = deferred<void>();
    const postMessage = jest.fn();
    const syncMediaCache = jest.fn().mockResolvedValue({ downloaded: 0, cleaned: 0 });
    const getMediaCacheMap = jest.fn().mockResolvedValue({});
    mockBroadcastRef = { postMessage };
    const db = {
      get: jest.fn((id: string) => {
        if (id === "media-library-meta") {
          return Promise.reject(Object.assign(new Error("missing"), { status: 404 }));
        }
        mediaReadStarted.resolve();
        return mediaRead.promise;
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
    await mediaReadStarted.promise;
    mockGlobalDb = {} as PouchDB.Database;
    mediaRead.resolve({ _id: "media", _rev: "1-media", list: [], folders: [] });

    await expect(flush).resolves.toEqual({ ok: true });
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
