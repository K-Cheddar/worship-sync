import {
  FLUSH_MEDIA_NO_DB_MESSAGE,
  FLUSH_MEDIA_STALE_DB_MESSAGE,
  flushMediaLibraryDocToPouch,
} from "./flushMediaLibraryDoc";

let mockGlobalDb: PouchDB.Database | undefined;

jest.mock("../context/controllerInfo", () => ({
  get globalDb() {
    return mockGlobalDb;
  },
  globalBroadcastRef: null,
}));

jest.mock("../store/store", () => ({
  __esModule: true,
  default: { dispatch: jest.fn() },
}));

describe("flushMediaLibraryDocToPouch", () => {
  beforeEach(() => {
    mockGlobalDb = undefined;
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
    const list = [{ id: "media-1", name: "Kept media" }];
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
});
