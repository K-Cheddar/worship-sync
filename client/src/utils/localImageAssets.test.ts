import type { ItemSlideType, ItemState, MediaType } from "../types";
import {
  attachCloudCopyToLocalImageItem,
  buildLocalImageUrl,
  collectLocalImageAssetIds,
  getRememberedLocalImagePolicy,
  getLocalAssetThumbnailDimensions,
  normalizeLocalImageReference,
  rememberLocalImagePolicy,
  updateLocalImageReferenceInItem,
  validateLocalImageFile,
} from "./localImageAssets";

const localMedia = (): MediaType => ({
  path: "",
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  format: "png",
  height: 1080,
  width: 1920,
  name: "Welcome.png",
  publicId: "asset-1",
  type: "image",
  id: "asset-1",
  background: buildLocalImageUrl("asset-1"),
  thumbnail: buildLocalImageUrl("asset-1"),
  source: "local",
  localImage: {
    id: "asset-1",
    ownerDeviceId: "device-1",
    ownerLabel: "Booth PC",
    fileName: "Welcome.png",
    contentType: "image/png",
    storagePolicy: "local-only",
  },
});

describe("localImageAssets", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.electronAPI;
  });

  it("scales list thumbnails to the shared 160 by 90 bound", () => {
    expect(getLocalAssetThumbnailDimensions(1920, 1080)).toEqual({
      width: 160,
      height: 90,
    });
    expect(getLocalAssetThumbnailDimensions(80, 45)).toEqual({
      width: 80,
      height: 45,
    });
  });

  it("remembers a validated policy per workspace", () => {
    expect(getRememberedLocalImagePolicy("church-1")).toBe("local-only");

    rememberLocalImagePolicy("church-1", "local-and-cloud");

    expect(getRememberedLocalImagePolicy("church-1")).toBe(
      "local-and-cloud",
    );
    expect(getRememberedLocalImagePolicy("church-2")).toBe("local-only");
    localStorage.setItem(
      "worshipsync_local_image_policy_v1:church-2",
      "unexpected",
    );
    expect(getRememberedLocalImagePolicy("church-2")).toBe("local-only");
  });

  it("accepts supported raster images and rejects unsupported or large files", () => {
    expect(
      validateLocalImageFile(new File(["image"], "welcome.png", { type: "image/png" })),
    ).toBeNull();
    expect(
      validateLocalImageFile(new File(["<svg />"], "logo.svg", { type: "image/svg+xml" })),
    ).toBe("Choose a PNG, JPEG, WebP, or GIF image.");
    const large = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.jpg", {
      type: "image/jpeg",
    });
    expect(validateLocalImageFile(large)).toBe(
      "Choose an image smaller than 25 MB.",
    );
  });

  it("adds a cloud fallback without replacing the durable local identity", () => {
    const media = localMedia();
    const item = {
      name: "Welcome",
      _id: "welcome",
      type: "free",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 0,
      arrangements: [],
      slides: [
        {
          id: "slide-1",
          name: "Section 1",
          type: "Section",
          boxes: [
            {
              id: "box-1",
              width: 100,
              height: 100,
              background: media.background,
              mediaInfo: media,
            },
          ],
        },
      ],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } satisfies ItemState;

    const result = attachCloudCopyToLocalImageItem(item, "asset-1", {
      mediaId: "media-1",
      url: "https://res.cloudinary.com/example/welcome.png",
    });

    expect(result.slides[0].boxes[0].background).toBe(
      buildLocalImageUrl("asset-1"),
    );
    expect(result.slides[0].boxes[0].mediaInfo?.localImage).toEqual(
      expect.objectContaining({
        id: "asset-1",
        storagePolicy: "local-and-cloud",
        cloudMediaId: "media-1",
        cloudUrl: "https://res.cloudinary.com/example/welcome.png",
      }),
    );
  });

  it("allows large supported images in Electron's disk-backed store", () => {
    window.electronAPI = {} as NonNullable<typeof window.electronAPI>;
    const large = new File(
      [new Uint8Array(25 * 1024 * 1024 + 1)],
      "large.jpg",
      { type: "image/jpeg" },
    );

    expect(validateLocalImageFile(large)).toBeNull();
  });

  it("relinks every use of an asset without changing its stable marker", () => {
    const media = localMedia();
    const slide: ItemSlideType = {
      id: "slide-1",
      name: "Section 1",
      type: "Section",
      boxes: [
        {
          id: "box-1",
          width: 100,
          height: 100,
          background: media.background,
          mediaInfo: media,
        },
      ],
    };
    const item = {
      name: "Welcome",
      _id: "welcome",
      type: "free",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 0,
      arrangements: [
        {
          id: "arr-1",
          name: "Default",
          formattedLyrics: [],
          songOrder: [],
          slides: [slide],
        },
      ],
      slides: [slide],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } satisfies ItemState;

    const result = updateLocalImageReferenceInItem(item, "asset-1", {
      reference: {
        ownerDeviceId: "device-2",
        fileName: "Replacement.png",
      },
      media: { name: "Replacement.png", width: 1280, height: 720 },
    });

    expect(collectLocalImageAssetIds(result)).toEqual(new Set(["asset-1"]));
    expect(result.slides[0].boxes[0].background).toBe(
      "local-image://asset-1",
    );
    expect(
      result.arrangements[0].slides[0].boxes[0].mediaInfo?.localImage,
    ).toEqual(
      expect.objectContaining({
        id: "asset-1",
        ownerDeviceId: "device-2",
        fileName: "Replacement.png",
      }),
    );
    expect(result.slides[0].boxes[0].mediaInfo).toEqual(
      expect.objectContaining({
        name: "Replacement.png",
        width: 1280,
        height: 720,
      }),
    );
  });

  it("normalizes safe synchronized metadata", () => {
    expect(
      normalizeLocalImageReference({
        id: " asset-1 ",
        ownerDeviceId: " device-1 ",
        ownerLabel: " Booth PC ",
        fileName: " Welcome.png ",
        contentType: " image/png ",
        storagePolicy: "local-and-cloud",
        cloudUrl: " https://res.cloudinary.com/example/welcome.png ",
      }),
    ).toEqual({
      id: "asset-1",
      ownerDeviceId: "device-1",
      ownerLabel: "Booth PC",
      fileName: "Welcome.png",
      contentType: "image/png",
      storagePolicy: "local-and-cloud",
      cloudUrl: "https://res.cloudinary.com/example/welcome.png",
    });
    expect(normalizeLocalImageReference({ id: "asset-1" })).toBeUndefined();
  });
});
