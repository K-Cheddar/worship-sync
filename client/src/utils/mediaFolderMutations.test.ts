import {
  MEDIA_LIBRARY_ROOT_VIEW,
  getMediaRouteFolderRepairs,
} from "./mediaFolderMutations";

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
