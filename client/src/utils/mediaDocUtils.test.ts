import {
  loadOrCreateMediaDoc,
  normalizeMediaDoc,
  siblingNameExists,
  wouldExceedMaxFolderDepth,
} from "./mediaDocUtils";
import type { DBMedia, MediaFolder, MediaType } from "../types";

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
