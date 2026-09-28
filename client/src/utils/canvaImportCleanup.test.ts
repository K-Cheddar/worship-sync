import type { mediaInfoType } from "../containers/Media/cloudinaryTypes";
import type { MuxUploadResult } from "../containers/Media/MediaUploadInput.types";
import {
  cleanupCanvaAssetsByLifecycle,
  cleanupUnprocessedCanvaAssets,
  type CanvaAssetLifecycle,
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

test("cleans unprocessed and in-flight assets but never a committed asset", async () => {
  const assets: CanvaImportedAsset[] = [
    { kind: "image", data: image("committed") },
    { kind: "image", data: image("active-save") },
    { kind: "video", data: video("not-started") },
  ];
  const lifecycle: CanvaAssetLifecycle[] = ["committed", "processing", "unprocessed"];
  const cleanup = jest.fn(async () => true);

  const failed = await cleanupCanvaAssetsByLifecycle(assets, lifecycle, cleanup);

  expect(cleanup).toHaveBeenNthCalledWith(1, assets[1]);
  expect(cleanup).toHaveBeenNthCalledWith(2, assets[2]);
  expect(failed).toEqual([]);
  expect(lifecycle).toEqual(["committed", "cleaned", "cleaned"]);
});

test("retains failed cleanup state so a later attempt can retry it", async () => {
  const asset = { kind: "image", data: image("cleanup-retry") } satisfies CanvaImportedAsset;
  const lifecycle: CanvaAssetLifecycle[] = ["failed"];
  const cleanup = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

  expect(await cleanupCanvaAssetsByLifecycle([asset], lifecycle, cleanup)).toEqual([asset]);
  expect(lifecycle).toEqual(["cleanup-pending"]);
  expect(await cleanupCanvaAssetsByLifecycle([asset], lifecycle, cleanup)).toEqual([]);
  expect(lifecycle).toEqual(["cleaned"]);
});

test("does not delete an asset while its media replacement needs reconciliation", async () => {
  const asset = { kind: "image", data: image("reconciliation-required") } satisfies CanvaImportedAsset;
  const lifecycle: CanvaAssetLifecycle[] = ["reconciliation-required"];
  const cleanup = jest.fn(async () => true);

  expect(await cleanupCanvaAssetsByLifecycle([asset], lifecycle, cleanup)).toEqual([]);
  expect(cleanup).not.toHaveBeenCalled();
  expect(lifecycle).toEqual(["reconciliation-required"]);
});
