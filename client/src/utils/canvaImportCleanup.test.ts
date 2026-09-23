import type { mediaInfoType } from "../containers/Media/cloudinaryTypes";
import type { MuxUploadResult } from "../containers/Media/MediaUploadInput.types";
import {
  cleanupUnprocessedCanvaAssets,
  mediaFromCanvaAsset,
  type CanvaImportedAsset,
} from "./canvaImportCleanup";

const image = (id: string) =>
  ({
    public_id: id,
    secure_url: `https://cdn.example/${id}.png`,
    thumbnail_url: `https://cdn.example/${id}-thumb.png`,
    resource_type: "image",
    format: "png",
    original_filename: id,
    path: "",
    created_at: "2026-01-01",
    width: 1,
    height: 1,
  }) as mediaInfoType;

const video = (id: string) =>
  ({
    playbackId: `playback-${id}`,
    assetId: id,
    playbackUrl: `https://stream.mux.com/${id}.m3u8`,
    thumbnailUrl: `https://image.mux.com/${id}/thumbnail.jpg`,
    name: id,
  }) as MuxUploadResult;

test("cleans unprocessed assets sequentially and retains cleanup failures", async () => {
  const assets: CanvaImportedAsset[] = [
    { kind: "image", data: image("page-3") },
    { kind: "video", data: video("page-4") },
  ];
  const cleanup = jest.fn(async (asset: CanvaImportedAsset) => asset.kind === "image");

  const failed = await cleanupUnprocessedCanvaAssets(assets, cleanup);

  expect(cleanup).toHaveBeenNthCalledWith(1, assets[0]);
  expect(cleanup).toHaveBeenNthCalledWith(2, assets[1]);
  expect(failed).toEqual([assets[1]]);
});

test("builds provider rows with the Cloudinary and Mux identities required for deletion", () => {
  expect(mediaFromCanvaAsset({ kind: "image", data: image("page-3") })).toMatchObject({
    source: "cloudinary",
    publicId: "page-3",
    type: "image",
  });
  expect(mediaFromCanvaAsset({ kind: "video", data: video("mux-page-4") })).toMatchObject({
    source: "mux",
    muxAssetId: "mux-page-4",
    type: "video",
  });
});
