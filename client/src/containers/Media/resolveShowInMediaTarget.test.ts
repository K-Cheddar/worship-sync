import {
  resolveShowInMediaFolderId,
  resolveShowInMediaId,
} from "./resolveShowInMediaTarget";
import { MEDIA_LIBRARY_ROOT_VIEW } from "../../utils/mediaFolderMutations";
import type { MediaType } from "../../types";

const media = (overrides: Partial<MediaType> = {}): MediaType =>
  ({
    id: "media-1",
    name: "1000063547.png",
    type: "image",
    background: "local-image://media-1",
    path: "",
    createdAt: "",
    updatedAt: "",
    format: "png",
    height: 100,
    width: 100,
    publicId: "media-1",
    ...overrides,
  }) as MediaType;

describe("resolveShowInMediaId", () => {
  it("resolves by mediaInfo.id when present in the library", () => {
    const item = media({ id: "local_image_abc", folderId: "folder-b" });
    expect(
      resolveShowInMediaId({
        box: {
          mediaInfo: item,
          background: item.background,
        },
        mediaList: [item],
      }),
    ).toBe("local_image_abc");
  });

  it("still returns mediaInfo.id when the library entry is temporarily missing", () => {
    expect(
      resolveShowInMediaId({
        box: {
          mediaInfo: media({ id: "missing-id" }),
          background: "local-image://missing-id",
        },
        mediaList: [],
      }),
    ).toBe("missing-id");
  });

  it("resolves by background when mediaInfo.id is absent", () => {
    const item = media({ id: "bg-match", background: "local-image://bg" });
    expect(
      resolveShowInMediaId({
        box: { background: "local-image://bg" },
        mediaList: [item],
      }),
    ).toBe("bg-match");
  });

  it("resolves live video inputs by source id", () => {
    const item = media({
      id: "live-1",
      type: "video",
      localVideoInput: {
        kind: "local-video-input",
        sourceId: "cam-1",
        label: "Booth",
        ownerDeviceId: "dev",
      },
    });
    expect(
      resolveShowInMediaId({
        box: { background: "" },
        mediaList: [item],
        slideVideoInput: item.localVideoInput,
      }),
    ).toBe("live-1");
  });
});

describe("resolveShowInMediaFolderId", () => {
  it("returns the item folder when set", () => {
    expect(resolveShowInMediaFolderId({ folderId: "folder-b" })).toBe(
      "folder-b",
    );
  });

  it("returns the library root view when folderId is unset", () => {
    expect(resolveShowInMediaFolderId({ folderId: null })).toBe(
      MEDIA_LIBRARY_ROOT_VIEW,
    );
    expect(resolveShowInMediaFolderId({})).toBe(MEDIA_LIBRARY_ROOT_VIEW);
  });
});
