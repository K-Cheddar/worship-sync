import {
  MEDIA_LIBRARY_ROOT_VIEW,
  getMediaRouteFolderRepairs,
  isMediaLibraryFolderEmpty,
} from "./mediaFolderMutations";
import type { MediaFolder, MediaType } from "../types";

describe("getMediaRouteFolderRepairs", () => {
  it("rewrites routes that pointed at a deleted folder", () => {
    const repairs = getMediaRouteFolderRepairs(
      { "controller-default": "f-del", "controller-item-song": "keep" },
      new Set(["f-del"]),
      MEDIA_LIBRARY_ROOT_VIEW,
    );
    expect(repairs).toEqual({
      "controller-default": MEDIA_LIBRARY_ROOT_VIEW,
    });
  });

  it("uses parent folder id as fallback when provided", () => {
    const repairs = getMediaRouteFolderRepairs(
      { "overlay-controller": "nested" },
      new Set(["nested"]),
      "parent-folder",
    );
    expect(repairs).toEqual({ "overlay-controller": "parent-folder" });
  });
});

describe("isMediaLibraryFolderEmpty", () => {
  const folders: MediaFolder[] = [
    {
      id: "parent",
      name: "Parent",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "empty",
      name: "Empty",
      parentId: "parent",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "child",
      name: "Child",
      parentId: "parent",
      createdAt: "",
      updatedAt: "",
    },
  ];

  it("returns true when there are no child folders and no media in the folder", () => {
    expect(isMediaLibraryFolderEmpty("empty", folders, [])).toBe(true);
  });

  it("returns false when a direct child folder exists", () => {
    expect(isMediaLibraryFolderEmpty("parent", folders, [])).toBe(false);
  });

  it("returns false when media is assigned to the folder", () => {
    const list = [
      { id: "m1", folderId: "empty", name: "x" } as MediaType,
    ];
    expect(isMediaLibraryFolderEmpty("empty", folders, list)).toBe(false);
  });
});
