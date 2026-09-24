import type { MediaType } from "../types";
import {
  getCanvaProviderCleanupKey,
  getCanvaProviderIdentity,
} from "./canvaProviderCleanup";

const media = (overrides: Partial<MediaType>): MediaType =>
  ({
    id: "media-1",
    path: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    format: "png",
    height: 1,
    width: 1,
    name: "Canva",
    publicId: "",
    type: "image",
    background: "",
    thumbnail: "",
    ...overrides,
  }) as MediaType;

test("retains different Cloudinary cleanup identities for one Media ID", () => {
  const first = media({ source: "cloudinary", publicId: "canva/old-a" });
  const second = media({ source: "cloudinary", publicId: "canva/old-b" });

  expect(getCanvaProviderCleanupKey(first)).not.toBe(
    getCanvaProviderCleanupKey(second),
  );
});

test("retains different Mux asset identities for one Media ID", () => {
  const first = media({
    source: "mux",
    type: "video",
    muxAssetId: "mux-old-a",
    muxPlaybackId: "shared-playback",
  });
  const second = media({
    source: "mux",
    type: "video",
    muxAssetId: "mux-old-b",
    muxPlaybackId: "shared-playback",
  });

  expect(getCanvaProviderIdentity(first)).toBe("mux-old-a");
  expect(getCanvaProviderCleanupKey(first)).not.toBe(
    getCanvaProviderCleanupKey(second),
  );
});
