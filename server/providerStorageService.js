import { randomUUID } from "node:crypto";
import {
  ChurchStorageQuotaError,
  ChurchProviderStorageNotReconciledError,
  getCloudinaryAssetBytes,
  getMuxStoredMinutes,
} from "./churchStorageQuota.js";

const requiredString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`${label} is required.`);
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
};

const churchFolder = (churchId) =>
  `worship-sync/churches/${encodeURIComponent(churchId)}/media`;
const canvaFolder = (churchId) =>
  `worship-sync/canva/${encodeURIComponent(churchId)}`;
const memberProfileFolder = (churchId) =>
  `member-profiles/${encodeURIComponent(churchId)}`;
const brandingFolder = (churchId) =>
  `branding/${encodeURIComponent(churchId)}`;
const temporaryConversionFolder = (churchId) =>
  `temporary-conversions/${encodeURIComponent(churchId)}`;
const mediaAssetId = (asset) =>
  String(asset?.asset_id || asset?.assetId || asset?.id || "").trim();
const cloudinaryAssetBytes = (asset) => getCloudinaryAssetBytes(asset);
const muxAssetMinutes = (asset) => getMuxStoredMinutes(asset);

export const createProviderStorageService = ({
  cloudinaryClient,
  getMuxClient,
  storageQuota,
}) => {
  const getCloudinaryAsset = async (publicId) =>
    cloudinaryClient.api.resource(publicId, { resource_type: "image" });

  const cloudinaryBelongsToChurch = (asset, churchId) => {
    const publicId = String(asset?.public_id || "");
    const folder = String(asset?.folder || "");
    return (
      publicId.startsWith(`${churchFolder(churchId)}/`) ||
      publicId.startsWith(`${canvaFolder(churchId)}/`) ||
      publicId.startsWith(`${memberProfileFolder(churchId)}/`) ||
      publicId.startsWith(`${brandingFolder(churchId)}/`) ||
      publicId.startsWith(`${temporaryConversionFolder(churchId)}/`) ||
      folder === churchFolder(churchId) ||
      folder.startsWith(`${churchFolder(churchId)}/`) ||
      folder === canvaFolder(churchId) ||
      folder.startsWith(`${canvaFolder(churchId)}/`) ||
      folder === memberProfileFolder(churchId) ||
      folder.startsWith(`${memberProfileFolder(churchId)}/`) ||
      folder === brandingFolder(churchId) ||
      folder.startsWith(`${brandingFolder(churchId)}/`) ||
      folder === temporaryConversionFolder(churchId) ||
      folder.startsWith(`${temporaryConversionFolder(churchId)}/`)
    );
  };

  const commitCloudinaryImage = async ({ churchId, publicId }) => {
    churchId = requiredString(churchId, "Church ID");
    publicId = requiredString(publicId, "Cloudinary public ID");
    const owner = await storageQuota.getProviderAssetOwner({
      provider: "cloudinaryBytes",
      assetId: publicId,
    });
    if (owner && owner.churchId !== churchId) {
      const error = new Error("That image belongs to another church.");
      error.statusCode = 403;
      throw error;
    }
    const asset = await getCloudinaryAsset(publicId);
    if (!cloudinaryBelongsToChurch(asset, churchId)) {
      const error = new Error("The image was not uploaded to this church's media folder.");
      error.statusCode = 403;
      throw error;
    }
    const bytes = cloudinaryAssetBytes(asset);
    if (!(bytes > 0)) {
      const error = new Error("Cloudinary did not report a valid stored image size.");
      error.statusCode = 502;
      throw error;
    }
    try {
      await cloudinaryClient.uploader.add_context(
        `worshipsync_church_id=${churchId}`,
        [publicId],
        { resource_type: "image" },
      );
      await storageQuota.recordProviderAsset({
        churchId,
        provider: "cloudinaryBytes",
        assetId: publicId,
        amount: bytes,
      });
    } catch (error) {
      if (
        (error instanceof ChurchStorageQuotaError || error instanceof ChurchProviderStorageNotReconciledError) &&
        !owner
      ) {
        await cloudinaryClient.uploader.destroy(publicId, {
          resource_type: "image",
          invalidate: true,
        });
      }
      throw error;
    }
    return {
      provider: "cloudinary",
      assetId: mediaAssetId(asset) || publicId,
      publicId,
      churchId,
      bytes,
      permanent: true,
    };
  };

  const createMuxUpload = async ({
    churchId,
    corsOrigin,
    mediaId,
    title,
    temporary = false,
  }) => {
    churchId = requiredString(churchId, "Church ID");
    const mux = getMuxClient?.();
    if (!mux) {
      const error = new Error("Mux is not configured.");
      error.statusCode = 503;
      throw error;
    }
    const identity = temporary
      ? `temporary:${randomUUID()}`
      : requiredString(mediaId, "Media ID");
    const usefulTitle = String(title || "").trim().slice(0, 180);
    if (!temporary) await storageQuota.assertProviderUsageReady(churchId);
    const upload = await mux.video.uploads.create({
      cors_origin: corsOrigin || "*",
      new_asset_settings: {
        playback_policy: ["public"],
        encoding_tier: "baseline",
        static_renditions: [{ resolution: "highest" }],
        meta: {
          creator_id: churchId,
          external_id: identity,
          ...(usefulTitle ? { title: usefulTitle } : {}),
        },
        passthrough: `worship-sync:church:${churchId}:${identity}`,
      },
    });
    try {
      await storageQuota.recordProviderUpload?.({
        churchId,
        provider: "mux",
        uploadId: upload.id,
        mediaId: temporary ? undefined : mediaId,
        temporary,
        status: upload.status || "waiting",
        assetId: upload.asset_id,
      });
    } catch (error) {
      if (typeof mux.video.uploads.cancel === "function") {
        await mux.video.uploads.cancel(upload.id).catch(() => {});
      }
      throw error;
    }
    return { uploadId: upload.id, url: upload.url };
  };

  const getMuxUpload = async ({ churchId, uploadId }) => {
    churchId = requiredString(churchId, "Church ID");
    const mux = getMuxClient?.();
    if (!mux) throw new Error("Mux is not configured.");
    const upload = await mux.video.uploads.retrieve(
      requiredString(uploadId, "Upload ID"),
    );
    if (upload.new_asset_settings?.meta?.creator_id !== churchId) {
      const error = new Error("That upload does not belong to this church.");
      error.statusCode = 403;
      throw error;
    }
    await storageQuota.recordProviderUpload?.({
      churchId,
      provider: "mux",
      uploadId: upload.id || uploadId,
      mediaId: upload.new_asset_settings?.meta?.external_id?.startsWith("temporary:")
        ? undefined
        : upload.new_asset_settings?.meta?.external_id,
      temporary: upload.new_asset_settings?.meta?.external_id?.startsWith("temporary:"),
      status: upload.status,
      assetId: upload.asset_id,
    });
    return { status: upload.status, assetId: upload.asset_id };
  };

  const getMuxAsset = async ({ churchId, assetId }) => {
    churchId = requiredString(churchId, "Church ID");
    const mux = getMuxClient?.();
    if (!mux) throw new Error("Mux is not configured.");
    const asset = await mux.video.assets.retrieve(
      requiredString(assetId, "Mux asset ID"),
    );
    const belongsToChurch =
      asset.meta?.creator_id === churchId ||
      asset.passthrough?.startsWith(`worship-sync:church:${churchId}:`);
    if (!belongsToChurch) {
      const owner = await storageQuota.getProviderAssetOwner({
        provider: "muxMinutes",
        assetId: asset.id,
      });
      if (owner?.churchId !== churchId) {
        const error = new Error("That video does not belong to this church.");
        error.statusCode = 403;
        throw error;
      }
    }
    const temporary = String(asset.meta?.external_id || "").startsWith("temporary:");
    const playbackId = asset.playback_ids?.[0]?.id;
    const staticRenditions = Array.isArray(asset.static_renditions)
      ? asset.static_renditions
      : [];
    const highestRendition = staticRenditions.find(
      (rendition) => rendition.resolution === "highest",
    );
    if (asset.status === "ready" && !temporary) {
      const durationMinutes = muxAssetMinutes(asset);
      if (!(durationMinutes > 0)) {
        const error = new Error("Mux did not report a valid stored video duration.");
        error.statusCode = 502;
        if (!owner) await mux.video.assets.delete(asset.id);
        throw error;
      }
      const owner = await storageQuota.getProviderAssetOwner({
        provider: "muxMinutes",
        assetId: asset.id,
      });
      try {
        await storageQuota.recordProviderAsset({
          churchId,
          provider: "muxMinutes",
          assetId: asset.id,
          amount: durationMinutes,
        });
      } catch (error) {
        if (
          (error instanceof ChurchStorageQuotaError || error instanceof ChurchProviderStorageNotReconciledError) &&
          !owner
        ) {
          await mux.video.assets.delete(asset.id);
        }
        throw error;
      }
    }
    return {
      status: asset.status,
      playbackId,
      assetId: asset.id,
      duration: asset.duration,
      temporary,
      aspectRatio: asset.aspect_ratio,
      staticRenditions: staticRenditions.map((rendition) => ({
        resolution: rendition.resolution,
        status: rendition.status,
        name: rendition.name,
      })),
      staticRenditionReady: highestRendition?.status === "ready",
    };
  };

  const deleteCloudinaryImage = async ({ churchId, publicId }) => {
    churchId = requiredString(churchId, "Church ID");
    publicId = requiredString(publicId, "Cloudinary public ID");
    const owner = await storageQuota.getProviderAssetOwner({
      provider: "cloudinaryBytes",
      assetId: publicId,
    });
    const asset = await getCloudinaryAsset(publicId).catch((error) => {
      if (error?.http_code === 404 || error?.response?.status === 404) return null;
      throw error;
    });
    if (owner?.churchId !== churchId && (!asset || !cloudinaryBelongsToChurch(asset, churchId))) {
      const error = new Error("That image does not belong to this church.");
      error.statusCode = 403;
      throw error;
    }
    if (asset) {
      const result = await cloudinaryClient.uploader.destroy(publicId, {
        resource_type: "image",
        invalidate: true,
      });
      if (result.result !== "ok" && result.result !== "not found") {
        throw new Error("Cloudinary did not confirm image deletion.");
      }
    }
    if (owner?.churchId === churchId) {
      await storageQuota.removeProviderAsset({
        churchId,
        provider: "cloudinaryBytes",
        assetId: publicId,
      });
    }
    return { success: true };
  };

  const deleteMuxAsset = async ({ churchId, assetId }) => {
    churchId = requiredString(churchId, "Church ID");
    assetId = requiredString(assetId, "Mux asset ID");
    const mux = getMuxClient?.();
    if (!mux) throw new Error("Mux is not configured.");
    const owner = await storageQuota.getProviderAssetOwner({
      provider: "muxMinutes",
      assetId,
    });
    let asset;
    try {
      asset = await mux.video.assets.retrieve(assetId);
    } catch (error) {
      if (error?.status !== 404 && error?.statusCode !== 404) throw error;
    }
    const metadataChurchId = asset?.meta?.creator_id;
    const passthroughMatches = asset?.passthrough?.startsWith(
      `worship-sync:church:${churchId}:`,
    );
    if (owner?.churchId !== churchId && metadataChurchId !== churchId && !passthroughMatches) {
      const error = new Error("That video does not belong to this church.");
      error.statusCode = 403;
      throw error;
    }
    if (asset) await mux.video.assets.delete(assetId);
    if (owner?.churchId === churchId) {
      await storageQuota.removeProviderAsset({
        churchId,
        provider: "muxMinutes",
        assetId,
      });
    }
    return { success: true };
  };

  return {
    commitCloudinaryImage,
    createMuxUpload,
    getMuxUpload,
    getMuxAsset,
    deleteCloudinaryImage,
    deleteMuxAsset,
  };
};
