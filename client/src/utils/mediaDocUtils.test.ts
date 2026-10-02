import {
  addMediaItem,
  loadMediaLibrary,
  loadOrCreateMediaDoc,
  mediaItemDocId,
  normalizeMediaDoc,
  parseMediaReplicationDoc,
  persistMediaStateChanges,
  removeMediaItem,
  saveMediaFolders,
  siblingNameExists,
  updateMediaItem,
  wouldExceedMaxFolderDepth,
} from "./mediaDocUtils";
import type { DBMedia, MediaFolder, MediaType } from "../types";

const pouchNotFound = () => Object.assign(new Error("missing"), { status: 404 });

describe("loadOrCreateMediaDoc", () => {
  const existingDoc = {
    _id: "media",
    _rev: "1-media",
    list: [],
    folders: [],
  } as DBMedia;

  it("returns an existing media document without writing", async () => {
    const db = {
      get: jest.fn().mockResolvedValue(existingDoc),
      put: jest.fn(),
    } as unknown as PouchDB.Database;

    await expect(loadOrCreateMediaDoc(db)).resolves.toBe(existingDoc);
    expect(db.put).not.toHaveBeenCalled();
  });

  it("creates and rereads an empty media document after a confirmed 404", async () => {
    const createdDoc = { ...existingDoc, _rev: "1-created" };
    const db = {
      get: jest
        .fn()
        .mockRejectedValueOnce({ status: 404, name: "not_found" })
        .mockResolvedValueOnce(createdDoc),
      put: jest.fn().mockResolvedValue({
        ok: true,
        id: "media",
        rev: "1-created",
      }),
    } as unknown as PouchDB.Database;

    await expect(loadOrCreateMediaDoc(db)).resolves.toEqual(createdDoc);
    expect(db.put).toHaveBeenCalledWith({
      _id: "media",
      list: [],
      folders: [],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      docType: "media",
    });
    expect(db.get).toHaveBeenCalledTimes(2);
  });

  it("rereads the winner when another writer creates the document first", async () => {
    const winningDoc = { ...existingDoc, _rev: "1-winner" };
    const db = {
      get: jest
        .fn()
        .mockRejectedValueOnce({ status: 404 })
        .mockResolvedValueOnce(winningDoc),
      put: jest.fn().mockRejectedValue({ status: 409, name: "conflict" }),
    } as unknown as PouchDB.Database;

    await expect(loadOrCreateMediaDoc(db)).resolves.toEqual(winningDoc);
  });

  it("does not create an empty document for a real read error", async () => {
    const readError = { status: 500, message: "storage unavailable" };
    const db = {
      get: jest.fn().mockRejectedValue(readError),
      put: jest.fn(),
    } as unknown as PouchDB.Database;

    await expect(loadOrCreateMediaDoc(db)).rejects.toBe(readError);
    expect(db.put).not.toHaveBeenCalled();
  });
});

describe("normalizeMediaDoc", () => {
  it("fills folders and fixes orphan folderId", () => {
    const folders: MediaFolder[] = [
      {
        id: "f1",
        name: "A",
        parentId: null,
        createdAt: "1",
        updatedAt: "1",
      },
    ];
    const list: MediaType[] = [
      {
        id: "m1",
        name: "x",
        type: "image",
        folderId: "missing",
        path: "",
        createdAt: "",
        updatedAt: "",
        format: "",
        height: 1,
        width: 1,
        publicId: "",
        background: "",
        thumbnail: "",
      },
    ];
    const doc = {
      _id: "media",
      _rev: "1",
      list,
      folders,
    } as DBMedia;
    const n = normalizeMediaDoc(doc);
    expect(n.folders).toEqual(folders);
    expect(n.list[0].folderId).toBeNull();
  });
});

describe("v2 media repository", () => {
  const media = (id: string, name = id): MediaType => ({
    id, name, type: "image", path: "", createdAt: "1", updatedAt: "1",
    format: "png", height: 1, width: 1, publicId: id, background: `/${id}`, thumbnail: "",
  });

  it("loads every v2 item by prefix, filters unrelated docs, and never reads legacy after activation", async () => {
    const rows = [
      { id: "media-item:a", doc: { ...media("a"), _id: "media-item:a", docType: "mediaItem" } },
      { id: "media-item:b", doc: { ...media("b"), _id: "media-item:b", docType: "mediaItem" } },
      { id: "media-item-meta:other", doc: { _id: "media-item-meta:other", docType: "other" } },
    ];
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        if (id === "media-folders") return { _id: id, folders: [{ id: "f", name: "Folder", parentId: null }] };
        throw pouchNotFound();
      }),
      allDocs: jest.fn().mockResolvedValue({ rows }),
    } as unknown as PouchDB.Database;

    await expect(loadMediaLibrary(db)).resolves.toEqual({
      list: [{ ...media("a"), folderId: null }, { ...media("b"), folderId: null }],
      folders: [{ id: "f", name: "Folder", parentId: null }],
    });
    expect(db.allDocs).toHaveBeenCalledWith({
      include_docs: true,
      startkey: "media-item:",
      endkey: "media-item:\uffff",
    });
    expect(db.get).not.toHaveBeenCalledWith("media");
  });

  it("keeps legacy reads active until schema v2 is explicitly marked", async () => {
    const legacy = { _id: "media", _rev: "1-media", list: [media("old")], folders: [] } as DBMedia;
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") throw pouchNotFound();
        return legacy;
      }),
      allDocs: jest.fn(),
    } as unknown as PouchDB.Database;
    await expect(loadMediaLibrary(db)).resolves.toEqual({ list: [{ ...media("old"), folderId: null }], folders: [] });
    expect(db.allDocs).not.toHaveBeenCalled();
  });

  it("writes only changed item docs and folder metadata for v2 changes", async () => {
    const existing = { ...media("edit", "Before"), _id: mediaItemDocId("edit"), docType: "mediaItem", _rev: "1" };
    const deleted = { ...media("delete"), _id: mediaItemDocId("delete"), docType: "mediaItem", _rev: "1" };
    const docs = new Map<string, any>([[existing._id, existing], [deleted._id, deleted]]);
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        const doc = docs.get(id);
        if (!doc) throw pouchNotFound();
        return doc;
      }),
      put: jest.fn(async (doc: any) => { docs.set(doc._id, { ...doc, _rev: "2" }); return { ok: true }; }),
      remove: jest.fn(async (doc: any) => { docs.delete(doc._id); return { ok: true }; }),
    } as unknown as PouchDB.Database;
    const folder = { id: "f", name: "Folder", parentId: null, createdAt: "1", updatedAt: "1" };
    const before = { list: [media("edit", "Before"), media("delete")], folders: [] };
    const after = { list: [media("edit", "After"), media("add")], folders: [folder] };

    await persistMediaStateChanges(db, before, after);
    expect(db.put).toHaveBeenCalledTimes(3);
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: mediaItemDocId("edit"), name: "After" }));
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: mediaItemDocId("add"), id: "add" }));
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: "media-folders", folders: [folder] }));
    expect(db.put).not.toHaveBeenCalledWith(expect.objectContaining({ _id: "media" }));
    expect(db.remove).toHaveBeenCalledWith(expect.objectContaining({ _id: mediaItemDocId("delete") }));
  });

  it("exposes direct add, edit, delete, and folder operations on item documents", async () => {
    const docs = new Map<string, any>();
    const put = jest.fn(async (doc: any) => { docs.set(doc._id, { ...doc, _rev: "1" }); return { ok: true }; });
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        const doc = docs.get(id);
        if (!doc) throw pouchNotFound();
        return doc;
      }),
      put,
      remove: jest.fn(async (doc: any) => { docs.delete(doc._id); return { ok: true }; }),
    } as unknown as PouchDB.Database;
    await addMediaItem(db, media("one"));
    await updateMediaItem(db, "one", { name: "Renamed" });
    await saveMediaFolders(db, [{ id: "folder", name: "Folder", parentId: null, createdAt: "1", updatedAt: "1" }]);
    await removeMediaItem(db, "one");
    expect(put.mock.calls.map(([doc]) => doc._id)).toEqual([
      "media-item:one", "media-item:one", "media-folders",
    ]);
    expect(db.remove).toHaveBeenCalledWith(expect.objectContaining({ _id: "media-item:one" }));
  });
});

describe("media replication document changes", () => {
  it("maps individual item updates, deletions, folders, and legacy docs without a full v2 list", () => {
    const item = { id: "slide-1", name: "Page 1", type: "image", background: "/one" } as MediaType;
    expect(parseMediaReplicationDoc({
      ...item,
      _id: "media-item:slide-1",
      _rev: "2-rev",
      docType: "mediaItem",
    })).toEqual({ kind: "item-upsert", item });
    expect(parseMediaReplicationDoc({ _id: "media-item:slide-1", _rev: "3-rev", _deleted: true }))
      .toEqual({ kind: "item-delete", id: "slide-1" });
    expect(parseMediaReplicationDoc({
      _id: "media-folders",
      docType: "mediaFolders",
      folders: [{ id: "f1", name: "Folder", parentId: null }],
    })).toEqual({ kind: "folders", folders: [{ id: "f1", name: "Folder", parentId: null }] });
    expect(parseMediaReplicationDoc({ _id: "unrelated", docType: "other" })).toBeNull();
  });

  it("accepts legacy replication only while schema v1 is active", () => {
    const legacy = { _id: "media", list: [{ id: "old", name: "Old" }], folders: [] };
    expect(parseMediaReplicationDoc(legacy)).toEqual({
      kind: "legacy",
      list: [{ id: "old", name: "Old", folderId: null }],
      folders: [],
    });
    expect(parseMediaReplicationDoc(legacy, true)).toBeNull();
  });

  it("continues to parse v2 item updates, deletes, and folders when schema v2 is active", () => {
    expect(parseMediaReplicationDoc({
      _id: "media-item:slide-1", id: "slide-1", docType: "mediaItem", name: "Updated",
    }, true)).toEqual({
      kind: "item-upsert",
      item: { id: "slide-1", name: "Updated" },
    });
    expect(parseMediaReplicationDoc({
      _id: "media-item:slide-1", _deleted: true,
    }, true)).toEqual({ kind: "item-delete", id: "slide-1" });
    expect(parseMediaReplicationDoc({
      _id: "media-folders", folders: [{ id: "folder-1", name: "Folder" }],
    }, true)).toEqual({
      kind: "folders",
      folders: [{ id: "folder-1", name: "Folder" }],
    });
  });
});

describe("siblingNameExists", () => {
  const folders: MediaFolder[] = [
    {
      id: "a",
      name: "Worship",
      parentId: null,
      createdAt: "1",
      updatedAt: "1",
    },
  ];
  it("is case-insensitive", () => {
    expect(siblingNameExists("worship", null, folders)).toBe(true);
    expect(siblingNameExists("Other", null, folders)).toBe(false);
  });
});

describe("wouldExceedMaxFolderDepth", () => {
  const folders: MediaFolder[] = Array.from({ length: 8 }, (_, i) => ({
    id: `f${i}`,
    name: `L${i}`,
    parentId: i === 0 ? null : `f${i - 1}`,
    createdAt: "1",
    updatedAt: "1",
  }));
  it("blocks new child at max depth", () => {
    expect(wouldExceedMaxFolderDepth("f7", folders)).toBe(true);
    expect(wouldExceedMaxFolderDepth("f6", folders)).toBe(false);
  });
});
