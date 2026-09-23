import type { MediaType } from "../types";
import type { mediaInfoType } from "../containers/Media/cloudinaryTypes";
import type { MuxUploadResult } from "../containers/Media/MediaUploadInput.types";

export type CanvaImportedAsset =
  | { kind: "image"; data: mediaInfoType }
  | { kind: "video"; data: MuxUploadResult };

export const mediaFromCanvaAsset = (asset: CanvaImportedAsset): MediaType => {
  if (asset.kind === "image") {
    return {
      path: asset.data.path || "",
      createdAt: asset.data.created_at || new Date().toISOString(),
      updatedAt: asset.data.created_at || new Date().toISOString(),
      format: asset.data.format || "png",
      height: asset.data.height || 0,
      width: asset.data.width || 0,
      name: asset.data.original_filename || asset.data.public_id,
      publicId: asset.data.public_id,
      type: "image",
      id: `canva-import:${asset.data.public_id}`,
      background: asset.data.secure_url,
      thumbnail: asset.data.thumbnail_url || asset.data.secure_url,
      source: "cloudinary",
    };
  }

  return {
    path: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    format: "m3u8",
    height: 0,
    width: 0,
    name: asset.data.name,
    publicId: asset.data.playbackId,
    type: "video",
    id: `canva-import:${asset.data.assetId}`,
    background: asset.data.playbackUrl,
    thumbnail: asset.data.thumbnailUrl,
    source: "mux",
    muxPlaybackId: asset.data.playbackId,
    muxAssetId: asset.data.assetId,
  };
};

export async function cleanupUnprocessedCanvaAssets(
  assets: readonly CanvaImportedAsset[],
  cleanupAsset: (asset: CanvaImportedAsset) => Promise<boolean>,
): Promise<CanvaImportedAsset[]> {
  const failed: CanvaImportedAsset[] = [];
  for (const asset of assets) {
    try {
      if (!(await cleanupAsset(asset))) failed.push(asset);
    } catch (error) {
      console.warn("Could not clean up an unprocessed Canva asset:", error);
      failed.push(asset);
    }
  }
  return failed;
}
