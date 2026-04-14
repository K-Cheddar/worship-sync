import {
  normalizeMediaDoc,
  siblingNameExists,
  wouldExceedMaxFolderDepth,
} from "./mediaDocUtils";
import type { DBMedia, MediaFolder, MediaType } from "../types";

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
