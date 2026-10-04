import {
  addMediaItem,
  loadMediaLibrary,
  mediaItemDocId,
  normalizeMediaDoc,
  parseMediaReplicationDoc,
  persistMediaLibraryChanges,
  persistMediaStateChanges,
  removeMediaItem,
  removeMediaItemAtRevision,
  readMediaItemForDeletion,
  saveMediaFolders,
  siblingNameExists,
  updateMediaItem,
  wouldExceedMaxFolderDepth,
} from "./mediaDocUtils";
import type { DBMedia, MediaFolder, MediaType } from "../types";

const pouchNotFound = () => Object.assign(new Error("missing"), { status: 404 });

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

  it("fails closed when the v2 marker is absent without reading or creating the legacy aggregate", async () => {
    const db = {
      get: jest.fn().mockRejectedValue(pouchNotFound()),
      put: jest.fn(),
      allDocs: jest.fn(),
    } as unknown as PouchDB.Database;
    await expect(loadMediaLibrary(db)).rejects.toThrow("schema v2 is not initialized");
    await expect(updateMediaItem(db, "item", { name: "Changed" })).rejects.toThrow("schema v2 is not initialized");
    expect(db.allDocs).not.toHaveBeenCalled();
    expect(db.get).not.toHaveBeenCalledWith("media");
    expect(db.put).not.toHaveBeenCalled();
  });

  it("does not remove or update anything when the v2 marker is absent", async () => {
    const db = {
      get: jest.fn().mockRejectedValue(pouchNotFound()),
      put: jest.fn(),
      remove: jest.fn(),
    } as unknown as PouchDB.Database;
    await expect(removeMediaItem(db, "item")).rejects.toThrow("schema v2 is not initialized");
    await expect(saveMediaFolders(db, [])).rejects.toThrow("schema v2 is not initialized");
    expect(db.put).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
    expect(db.get).not.toHaveBeenCalledWith("media");
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

  it("preserves media replicated after a folder operation captured its list", async () => {
    const folder = { id: "folder", name: "Folder", parentId: null } as MediaFolder;
    const beforeItem = { ...media("known"), folderId: "folder" };
    const persisted = new Map<string, any>([
      [mediaItemDocId("known"), { ...beforeItem, _id: mediaItemDocId("known"), docType: "mediaItem", _rev: "1" }],
      [mediaItemDocId("remote"), { ...media("remote"), folderId: "folder", _id: mediaItemDocId("remote"), docType: "mediaItem", _rev: "1" }],
    ]);
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        if (id === "media-folders") return { _id: id, folders: [folder] };
        const doc = persisted.get(id);
        if (doc) return doc;
        throw pouchNotFound();
      }),
      allDocs: jest.fn(async () => ({ rows: [...persisted.values()].map((doc) => ({ id: doc._id, doc })) })),
      put: jest.fn(async (doc: any) => { persisted.set(doc._id, { ...doc, _rev: "2" }); return { ok: true }; }),
      remove: jest.fn(async (doc: any) => { persisted.delete(doc._id); return { ok: true }; }),
    } as unknown as PouchDB.Database;

    await persistMediaLibraryChanges(
      db,
      { list: [beforeItem], folders: [folder] },
      { list: [{ ...beforeItem, folderId: null }], folders: [] },
    );

    expect(persisted.get(mediaItemDocId("known"))?.folderId).toBeNull();
    expect(persisted.get(mediaItemDocId("remote"))?.folderId).toBeNull();
    expect(db.remove).not.toHaveBeenCalled();
  });

  it("broadcasts the complete saved item when optional fields are removed", async () => {
    const previous = {
      ...media("edit", "Before"),
      folderId: "folder-a",
      thumbnail: "/old-thumbnail.jpg",
    };
    const next = media("edit", "After");
    const existing = {
      ...previous,
      _id: mediaItemDocId("edit"),
      docType: "mediaItem",
      _rev: "1",
    };
    const docs = new Map<string, any>([[existing._id, existing]]);
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        const doc = docs.get(id);
        if (!doc) throw pouchNotFound();
        return doc;
      }),
      put: jest.fn(async (doc: any) => {
        docs.set(doc._id, { ...doc, _rev: "2" });
        return { ok: true };
      }),
      remove: jest.fn(),
    } as unknown as PouchDB.Database;

    const changedDocs = await persistMediaStateChanges(
      db,
      { list: [previous], folders: [] },
      { list: [next], folders: [] },
    );

    expect(db.put).toHaveBeenCalledWith(expect.not.objectContaining({
      folderId: expect.anything(),
      thumbnail: expect.anything(),
    }));
    expect(changedDocs).toEqual([{
      ...next,
      id: "edit",
      _id: mediaItemDocId("edit"),
      docType: "mediaItem",
    }]);
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

  it("re-fetches and retries a conflicting deletion with the latest revision", async () => {
    const docs = new Map<string, any>([[
      mediaItemDocId("conflict"),
      { ...media("conflict"), _id: mediaItemDocId("conflict"), docType: "mediaItem", _rev: "1-a" },
    ]]);
    const get = jest.fn(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = docs.get(id);
      if (!doc) throw pouchNotFound();
      return doc;
    });
    const remove = jest.fn(async (doc: any) => {
      if (remove.mock.calls.length === 1) {
        docs.set(doc._id, { ...doc, _rev: "2-newer" });
        throw Object.assign(new Error("conflict"), { status: 409 });
      }
      docs.delete(doc._id);
      return { ok: true, id: doc._id };
    });
    const db = { get, remove } as unknown as PouchDB.Database;

    await expect(removeMediaItem(db, "conflict")).resolves.toEqual({
      ok: true,
      id: mediaItemDocId("conflict"),
    });
    expect(remove.mock.calls.map(([doc]) => doc._rev)).toEqual(["1-a", "2-newer"]);
    expect(docs.has(mediaItemDocId("conflict"))).toBe(false);
  });

  it("does not retry an exact-revision deletion after a conflict", async () => {
    const doc = {
      ...media("exact-revision"),
      _id: mediaItemDocId("exact-revision"),
      _rev: "4-captured",
      docType: "mediaItem",
    } as any;
    const db = {
      remove: jest.fn(async () => { throw Object.assign(new Error("conflict"), { status: 409 }); }),
    } as unknown as PouchDB.Database;

    await expect(removeMediaItemAtRevision(db, doc)).rejects.toMatchObject({ status: 409 });
    expect(db.remove).toHaveBeenCalledTimes(1);
    expect(db.remove).toHaveBeenCalledWith(doc);
  });

  it("returns authoritative media metadata and revision from the v2 item document", async () => {
    const persisted = {
      ...media("authoritative"),
      name: "Persisted name",
      publicId: "persisted-provider-id",
      _id: mediaItemDocId("authoritative"),
      _rev: "7-persisted",
      docType: "mediaItem",
    };
    const db = {
      get: jest.fn(async (id: string) => id === "media-library-meta"
        ? { _id: id, schemaVersion: 2 }
        : persisted),
    } as unknown as PouchDB.Database;

    await expect(readMediaItemForDeletion(db, "authoritative")).resolves.toEqual({
      doc: persisted,
      item: expect.objectContaining({ name: "Persisted name", publicId: "persisted-provider-id" }),
    });
  });

  it("treats an already missing item document as an idempotent deletion", async () => {
    const get = jest.fn(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      throw pouchNotFound();
    });
    const remove = jest.fn();
    const db = { get, remove } as unknown as PouchDB.Database;

    await expect(removeMediaItem(db, "already-gone")).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it("treats a concurrent tombstone after get as idempotent success", async () => {
    const doc = {
      ...media("concurrent-delete"),
      _id: mediaItemDocId("concurrent-delete"),
      docType: "mediaItem",
      _rev: "1-current",
    };
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
        return doc;
      }),
      remove: jest.fn(async () => {
        throw pouchNotFound();
      }),
    } as unknown as PouchDB.Database;

    await expect(removeMediaItem(db, "concurrent-delete")).resolves.toBeUndefined();
    expect(db.remove).toHaveBeenCalledWith(doc);
  });
});

describe("media replication document changes", () => {
  it("maps individual item updates, deletions, and folders without a full v2 list", () => {
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

  it("ignores legacy aggregate replication documents", () => {
    const legacy = { _id: "media", list: [{ id: "old", name: "Old" }], folders: [] };
    expect(parseMediaReplicationDoc(legacy)).toBeNull();
  });

  it("parses v2 item updates, deletes, and folders", () => {
    expect(parseMediaReplicationDoc({
      _id: "media-item:slide-1", id: "slide-1", docType: "mediaItem", name: "Updated",
    })).toEqual({
      kind: "item-upsert",
      item: { id: "slide-1", name: "Updated" },
    });
    expect(parseMediaReplicationDoc({
      _id: "media-item:slide-1", _deleted: true,
    })).toEqual({ kind: "item-delete", id: "slide-1" });
    expect(parseMediaReplicationDoc({
      _id: "media-folders", folders: [{ id: "folder-1", name: "Folder" }],
    })).toEqual({
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
