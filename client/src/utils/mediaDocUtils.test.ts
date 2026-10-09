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
import { MEDIA_LIBRARY_ROOT_VIEW } from "./mediaFolderMutations";
import type { DBMedia, MediaFolder, MediaType } from "../types";

const pouchNotFound = () => Object.assign(new Error("missing"), { status: 404 });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};

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

  const folder = (id: string, parentId: string | null): MediaFolder => ({
    id, name: `Folder ${id}`, parentId, createdAt: `created-${id}`, updatedAt: `updated-${id}`,
  });

  const makePersistedDb = (folders: MediaFolder[], items: MediaType[] = []) => {
    const docs = new Map<string, any>([
      ["media-library-meta", { _id: "media-library-meta", docType: "mediaLibraryMeta", schemaVersion: 2 }],
      ["media-folders", { _id: "media-folders", docType: "mediaFolders", folders, _rev: "1" }],
      ...items.map((item) => [mediaItemDocId(item.id), {
        ...item, _id: mediaItemDocId(item.id), docType: "mediaItem", _rev: "1",
      }] as [string, any]),
    ]);
    const db = {
      get: jest.fn(async (id: string) => {
        const doc = docs.get(id);
        if (doc) return { ...doc };
        throw pouchNotFound();
      }),
      allDocs: jest.fn(async () => ({
        rows: [...docs.entries()]
          .filter(([id]) => id.startsWith("media-item:"))
          .map(([id, doc]) => ({ id, doc: { ...doc } })),
      })),
      put: jest.fn(async (doc: any) => {
        const id = String(doc._id);
        const current = docs.get(id);
        if (current && current._rev !== doc._rev) {
          throw Object.assign(new Error("conflict"), { status: 409, name: "conflict" });
        }
        const rev = String(Number(current?._rev ?? 0) + 1);
        docs.set(id, { ...doc, _rev: rev });
        return { ok: true, id, rev };
      }),
      remove: jest.fn(async (doc: any) => {
        docs.delete(String(doc._id));
        return { ok: true };
      }),
    } as unknown as PouchDB.Database;
    return { db, docs };
  };

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

  it("rehomes a PouchDB-only child when its parent folder is deleted", async () => {
    const parent = folder("ancestor", null);
    const target = folder("deleted", parent.id);
    const concurrentChild = { ...folder("concurrent", target.id), name: "Created in another controller" };
    const { db, docs } = makePersistedDb([parent, target, concurrentChild]);

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [parent, target] },
      { list: [], folders: [parent] },
    );

    expect(docs.get("media-folders").folders).toEqual([
      parent,
      { ...concurrentChild, parentId: parent.id },
    ]);
    expect(docs.get("media-folders").folders.some((saved: MediaFolder) => saved.id === target.id)).toBe(false);
  });

  it("uses the deleted folder's latest persisted parent when finalization starts", async () => {
    const originalParent = folder("original-parent", null);
    const latestParent = folder("latest-parent", null);
    const target = folder("deleted", originalParent.id);
    const movedTarget = { ...target, parentId: latestParent.id };
    const concurrentChild = folder("concurrent", target.id);
    const { db, docs } = makePersistedDb([
      originalParent,
      latestParent,
      movedTarget,
      concurrentChild,
    ]);

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [originalParent, latestParent, target] },
      { list: [], folders: [originalParent, latestParent] },
    );

    expect(docs.get("media-folders").folders).toEqual([
      originalParent,
      latestParent,
      { ...concurrentChild, parentId: latestParent.id },
    ]);
  });

  it("recomputes the replacement parent from the latest revision after a folder conflict", async () => {
    const originalParent = folder("original-parent", null);
    const latestParent = folder("latest-parent", null);
    const target = folder("deleted", originalParent.id);
    const concurrentChild = folder("concurrent", target.id);
    const { db, docs } = makePersistedDb([originalParent, latestParent, target]);
    const put = db.put as jest.Mock;
    const firstWriteStarted = deferred<void>();
    const allowFirstWriteToConflict = deferred<void>();
    put.mockImplementationOnce(async () => {
      firstWriteStarted.resolve();
      await allowFirstWriteToConflict.promise;
      throw Object.assign(new Error("conflict"), { status: 409, name: "conflict" });
    });

    const persistence = persistMediaLibraryChanges(
      db,
      { list: [], folders: [originalParent, latestParent, target] },
      { list: [], folders: [originalParent, latestParent] },
    );
    await firstWriteStarted.promise;
    docs.set("media-folders", {
      ...docs.get("media-folders"),
      folders: [
        originalParent,
        latestParent,
        { ...target, parentId: latestParent.id },
        concurrentChild,
      ],
      _rev: "2",
    });
    allowFirstWriteToConflict.resolve();
    await persistence;

    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][0]).toEqual(expect.objectContaining({
      _rev: "2",
      folders: [
        originalParent,
        latestParent,
        { ...concurrentChild, parentId: latestParent.id },
      ],
    }));
    expect(docs.get("media-folders").folders).toEqual([
      originalParent,
      latestParent,
      { ...concurrentChild, parentId: latestParent.id },
    ]);
  });

  it("traverses the latest parent chain when multiple deleted ancestors contain a child", async () => {
    const originalParent = folder("original-parent", null);
    const latestParent = folder("latest-parent", null);
    const target = folder("deleted-root", originalParent.id);
    const deletedChild = folder("deleted-child", target.id);
    const deletedGrandchild = folder("deleted-grandchild", deletedChild.id);
    const survivingFolder = folder("surviving", deletedGrandchild.id);
    const latestTarget = { ...target, parentId: latestParent.id };
    const { db, docs } = makePersistedDb([
      originalParent,
      latestParent,
      latestTarget,
      deletedChild,
      deletedGrandchild,
      survivingFolder,
    ]);

    await persistMediaLibraryChanges(
      db,
      {
        list: [],
        folders: [originalParent, latestParent, target, deletedChild, deletedGrandchild],
      },
      { list: [], folders: [originalParent, latestParent] },
    );

    expect(docs.get("media-folders").folders).toEqual([
      originalParent,
      latestParent,
      { ...survivingFolder, parentId: latestParent.id },
    ]);
  });

  it("persists a concurrent child of a deleted root folder at the library root", async () => {
    const target = folder("deleted-root", null);
    const concurrentChild = folder("concurrent", target.id);
    const { db, docs } = makePersistedDb([target, concurrentChild]);

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [target] },
      { list: [], folders: [] },
    );

    const savedChild = docs.get("media-folders").folders.find((saved: MediaFolder) => saved.id === concurrentChild.id);
    expect(savedChild?.parentId).toBeNull();
    expect(savedChild?.parentId).not.toBe(MEDIA_LIBRARY_ROOT_VIEW);
    expect(docs.get("media-folders").folders).not.toContainEqual(expect.objectContaining({ id: target.id }));
  });

  it("rehomes PouchDB-only media through deleted nested folders using the latest parent chain", async () => {
    const originalParent = folder("original-parent", null);
    const latestParent = folder("latest-parent", null);
    const target = folder("deleted", latestParent.id);
    const nestedDeleted = folder("nested-deleted", target.id);
    const pouchOnlyMedia = { ...media("pouch-only-media"), folderId: nestedDeleted.id };
    const { db, docs } = makePersistedDb(
      [originalParent, latestParent, target, nestedDeleted],
      [pouchOnlyMedia],
    );

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [originalParent, latestParent, { ...target, parentId: originalParent.id }, nestedDeleted] },
      { list: [], folders: [originalParent, latestParent] },
    );

    expect(docs.get(mediaItemDocId(pouchOnlyMedia.id))?.folderId).toBe(latestParent.id);
    expect(docs.get("media-folders").folders).toEqual([originalParent, latestParent]);
  });

  it("ignores a stale local media folder assignment when the persisted item moved into the deleted folder", async () => {
    const staleFolder = folder("stale-folder", null);
    const survivingParent = folder("surviving-parent", null);
    const deletedFolder = folder("deleted-folder", survivingParent.id);
    const reduxItem = { ...media("remotely-moved-media"), folderId: staleFolder.id };
    const persistedItem = { ...reduxItem, folderId: deletedFolder.id };
    const { db, docs } = makePersistedDb(
      [staleFolder, survivingParent, deletedFolder],
      [persistedItem],
    );

    await persistMediaLibraryChanges(
      db,
      { list: [reduxItem], folders: [staleFolder, survivingParent, deletedFolder] },
      { list: [reduxItem], folders: [staleFolder, survivingParent] },
    );

    expect(docs.get(mediaItemDocId(reduxItem.id))?.folderId).toBe(survivingParent.id);
    expect(docs.get("media-folders").folders).toEqual([staleFolder, survivingParent]);
  });

  it("moves PouchDB-only media from a deleted root folder to the library root", async () => {
    const target = folder("deleted-root", null);
    const pouchOnlyMedia = { ...media("pouch-only-root-media"), folderId: target.id };
    const { db, docs } = makePersistedDb([target], [pouchOnlyMedia]);

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [target] },
      { list: [], folders: [] },
    );

    expect(docs.get(mediaItemDocId(pouchOnlyMedia.id))?.folderId).toBeNull();
    expect(docs.get("media-folders").folders).toEqual([]);
  });

  it("preserves a concurrent valid media move when the rehome write gets a 409", async () => {
    const parent = folder("ancestor", null);
    const target = folder("deleted", parent.id);
    const outside = folder("outside", null);
    const item = { ...media("moving-media"), folderId: target.id };
    const { db, docs } = makePersistedDb([parent, target, outside], [item]);
    const put = db.put as jest.Mock;
    put.mockImplementationOnce(async () => {
      docs.set(mediaItemDocId(item.id), {
        ...item,
        folderId: outside.id,
        _id: mediaItemDocId(item.id),
        docType: "mediaItem",
        _rev: "2",
      });
      throw Object.assign(new Error("conflict"), { status: 409, name: "conflict" });
    });

    await persistMediaLibraryChanges(
      db,
      { list: [item], folders: [parent, target, outside] },
      { list: [{ ...item, folderId: parent.id }], folders: [parent, outside] },
    );

    expect(docs.get(mediaItemDocId(item.id))?.folderId).toBe(outside.id);
    expect(docs.get("media-folders").folders).toEqual([parent, outside]);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("uses a surviving ancestor when a concurrent folder's parent was removed remotely", async () => {
    const ancestor = folder("ancestor", null);
    const remotelyRemovedParent = folder("remote-parent", ancestor.id);
    const target = folder("deleted", null);
    const concurrentChild = folder("concurrent", remotelyRemovedParent.id);
    const { db, docs } = makePersistedDb([ancestor, target, concurrentChild]);

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [ancestor, remotelyRemovedParent, target] },
      { list: [], folders: [ancestor, remotelyRemovedParent] },
    );

    expect(docs.get("media-folders").folders).toEqual([
      ancestor,
      { ...concurrentChild, parentId: ancestor.id },
    ]);
    expect(docs.get("media-folders").folders).not.toContainEqual(
      expect.objectContaining({ id: remotelyRemovedParent.id }),
    );
  });

  it("preserves nested concurrent folders while rehoming only the direct child", async () => {
    const parent = folder("ancestor", null);
    const target = folder("deleted", parent.id);
    const concurrentChild = folder("concurrent", target.id);
    const nestedChild = folder("nested", concurrentChild.id);
    const { db, docs } = makePersistedDb([parent, target, concurrentChild, nestedChild]);

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [parent, target] },
      { list: [], folders: [parent] },
    );

    expect(docs.get("media-folders").folders).toEqual([
      parent,
      { ...concurrentChild, parentId: parent.id },
      nestedChild,
    ]);
  });

  it("falls back to root when rehoming to an ancestor would create a cycle", async () => {
    const parent = folder("ancestor", null);
    const target = folder("deleted", parent.id);
    const concurrentChild = folder("concurrent", target.id);
    const movedParent = { ...parent, parentId: concurrentChild.id };
    const { db, docs } = makePersistedDb([movedParent, target, concurrentChild]);

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [parent, target] },
      { list: [], folders: [parent] },
    );

    expect(docs.get("media-folders").folders).toEqual([
      { ...movedParent, parentId: concurrentChild.id },
      { ...concurrentChild, parentId: null },
    ]);
  });

  it("keeps a concurrent valid folder move made before a folder-document conflict", async () => {
    const parent = folder("ancestor", null);
    const target = folder("deleted", parent.id);
    const outside = folder("outside", null);
    const concurrentChild = folder("concurrent", target.id);
    const { db, docs } = makePersistedDb([parent, target, outside, concurrentChild]);
    const put = db.put as jest.Mock;
    put.mockImplementationOnce(async (doc: any) => {
      docs.set("media-folders", {
        ...docs.get("media-folders"),
        folders: [parent, target, outside, { ...concurrentChild, parentId: outside.id }],
        _rev: "2",
      });
      throw Object.assign(new Error("conflict"), { status: 409, name: "conflict" });
    });

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [parent, target, outside] },
      { list: [], folders: [parent, outside] },
    );

    expect(docs.get("media-folders").folders).toEqual([
      parent,
      outside,
      { ...concurrentChild, parentId: outside.id },
    ]);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("keeps media assigned to a concurrent folder that survives subtree deletion", async () => {
    const parent = folder("ancestor", null);
    const target = folder("deleted", parent.id);
    const concurrentChild = folder("concurrent", target.id);
    const item = { ...media("concurrent-media"), folderId: concurrentChild.id };
    const { db, docs } = makePersistedDb([parent, target, concurrentChild], [item]);

    await persistMediaLibraryChanges(
      db,
      { list: [], folders: [parent, target] },
      { list: [], folders: [parent] },
    );

    expect(docs.get(mediaItemDocId(item.id))).toEqual(expect.objectContaining(item));
    expect(docs.get("media-folders").folders).toContainEqual({ ...concurrentChild, parentId: parent.id });
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
