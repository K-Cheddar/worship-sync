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

const normalizeCloudinaryPath = (value) =>
  String(value || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");

const cloudinaryPathIsInFolder = (value, expectedFolder) => {
  const path = normalizeCloudinaryPath(value);
  const folder = normalizeCloudinaryPath(expectedFolder);
  return path === folder || path.startsWith(`${folder}/`);
};

export const createProviderStorageService = ({
  cloudinaryClient,
  cloudinaryApiSecret,
  getMuxClient,
  storageQuota,
}) => {
  let cloudinaryFolderModePromise;

  const providerError = (message, code, statusCode = 502) => {
    const error = new Error(message);
    error.code = code;
    error.provider = "cloudinary";
    error.statusCode = statusCode;
    return error;
  };

  const getCloudinaryFolderMode = () => {
    if (!cloudinaryFolderModePromise) {
      cloudinaryFolderModePromise = Promise.resolve()
        .then(async () => {
          const response = await cloudinaryClient.api.config({ settings: true });
          const mode = response?.settings?.folder_mode;
          if (mode !== "dynamic" && mode !== "fixed") {
            throw providerError(
              "Cloudinary did not report a supported folder mode.",
              "CLOUDINARY_CONFIGURATION_UNAVAILABLE",
              503,
            );
          }
          return mode;
        })
        .catch((error) => {
          cloudinaryFolderModePromise = undefined;
          if (error?.code === "CLOUDINARY_CONFIGURATION_UNAVAILABLE") throw error;
          throw providerError(
            "Cloudinary folder configuration could not be read.",
            "CLOUDINARY_CONFIGURATION_UNAVAILABLE",
            503,
          );
        });
    }
    return cloudinaryFolderModePromise;
  };

  const getCloudinaryAsset = async (publicId) =>
    cloudinaryClient.api.resource(publicId, { resource_type: "image" });

  const cloudinaryBelongsToChurch = (asset, churchId) => {
    const expectedFolders = [
      churchFolder(churchId),
      canvaFolder(churchId),
      memberProfileFolder(churchId),
      brandingFolder(churchId),
      temporaryConversionFolder(churchId),
    ];
    return expectedFolders.some((folder) =>
      [asset?.public_id, asset?.folder, asset?.asset_folder].some((path) =>
        cloudinaryPathIsInFolder(path, folder),
      ),
    );
  };

  const cloudinaryAssetIsChurchMedia = (asset, churchId) =>
    [asset?.public_id, asset?.folder, asset?.asset_folder].some((path) =>
      cloudinaryPathIsInFolder(path, churchFolder(churchId)),
    );

  const createCloudinaryImageUpload = async ({ churchId, mediaId }) => {
    churchId = requiredString(churchId, "Church ID");
    mediaId = requiredString(mediaId, "Media ID");
    if (!cloudinaryClient || typeof cloudinaryApiSecret !== "string" || !cloudinaryApiSecret) {
      throw providerError(
        "Cloudinary signed uploads are not configured.",
        "CLOUDINARY_CONFIGURATION_UNAVAILABLE",
        503,
      );
    }
    await storageQuota.assertProviderUsageReady(churchId);
    const folderMode = await getCloudinaryFolderMode();
    const apiKey = cloudinaryClient.config?.()?.api_key;
    if (typeof apiKey !== "string" || !apiKey) {
      throw providerError(
        "Cloudinary signed uploads are not configured.",
        "CLOUDINARY_CONFIGURATION_UNAVAILABLE",
        503,
      );
    }
    const uploadId = randomUUID();
    const basePublicId = `worship-sync-${randomUUID()}`;
    const folder = churchFolder(churchId);
    const expectedPublicId = folderMode === "fixed"
      ? `${folder}/${basePublicId}`
      : basePublicId;
    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = {
      timestamp,
      public_id: basePublicId,
      overwrite: false,
      ...(folderMode === "dynamic" ? { asset_folder: folder } : { folder }),
    };
    const signature = cloudinaryClient.utils.api_sign_request(
      paramsToSign,
      cloudinaryApiSecret,
    );
    await storageQuota.recordProviderUpload({
      churchId,
      provider: "cloudinary",
      uploadId,
      mediaId,
      assetId: expectedPublicId,
      folderMode,
      status: "waiting",
    });
    const fields = {
      api_key: apiKey,
      timestamp: String(timestamp),
      signature,
      public_id: basePublicId,
      overwrite: "false",
      ...(folderMode === "dynamic" ? { asset_folder: folder } : { folder }),
    };
    return {
      uploadId,
      uploadUrl: "https://api.cloudinary.com/v1_1/portable-media/image/upload",
      publicId: expectedPublicId,
      fields,
    };
  };

  const commitLegacyCloudinaryImage = async ({ churchId, publicId }) => {
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
    if (!cloudinaryAssetIsChurchMedia(asset, churchId)) {
      const error = new Error("The image was not uploaded to this church's media folder.");
      error.statusCode = 403;
      error.code = "CLOUDINARY_MEDIA_OWNERSHIP_MISMATCH";
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

  const commitCloudinaryImage = async ({ churchId, uploadId, publicId }) => {
    churchId = requiredString(churchId, "Church ID");
    if (!uploadId) return commitLegacyCloudinaryImage({ churchId, publicId });
    uploadId = requiredString(uploadId, "Upload ID");
    publicId = requiredString(publicId, "Cloudinary public ID");
    const intent = await storageQuota.getProviderUpload({
      provider: "cloudinary",
      uploadId,
    });
    if (!intent) {
      const error = new Error("That image upload could not be found.");
      error.statusCode = 404;
      error.code = "CLOUDINARY_UPLOAD_NOT_FOUND";
      throw error;
    }
    if (intent.churchId !== churchId || intent.assetId !== publicId) {
      const error = new Error("That image upload does not belong to this church.");
      error.statusCode = 403;
      error.code = "CLOUDINARY_MEDIA_OWNERSHIP_MISMATCH";
      throw error;
    }
    if (intent.status === "cancelled" || intent.status === "cancelling") {
      const error = new Error("That image upload was cancelled.");
      error.statusCode = 409;
      error.code = "CLOUDINARY_UPLOAD_CANCELLED";
      throw error;
    }
    const claimed = await storageQuota.transitionProviderUpload({
      provider: "cloudinary",
      uploadId,
      fromStatuses: ["waiting", "committing"],
      status: "committing",
    });
    if (!claimed || claimed.churchId !== churchId || claimed.assetId !== publicId) {
      const error = new Error("That image upload could not be committed.");
      error.statusCode = 409;
      error.code = "CLOUDINARY_UPLOAD_NOT_COMMITTABLE";
      throw error;
    }
    if (claimed.status === "committed") {
      const owner = await storageQuota.getProviderAssetOwner({
        provider: "cloudinaryBytes",
        assetId: publicId,
      });
      if (owner?.churchId === churchId) {
        const existingAsset = await getCloudinaryAsset(publicId);
        return {
          provider: "cloudinary",
          assetId: mediaAssetId(existingAsset) || publicId,
          publicId,
          churchId,
          bytes: cloudinaryAssetBytes(existingAsset),
          permanent: true,
        };
      }
    }
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
    if (String(asset?.public_id || "") !== publicId) {
      throw providerError(
        "Cloudinary returned an unexpected image identity.",
        "CLOUDINARY_MEDIA_IDENTITY_MISMATCH",
      );
    }
    const folderMode = intent.folderMode || await getCloudinaryFolderMode();
    const expectedFolder = churchFolder(churchId);
    const isExpectedFolder = folderMode === "dynamic"
      ? normalizeCloudinaryPath(asset?.asset_folder) === expectedFolder
      : normalizeCloudinaryPath(asset?.folder) === expectedFolder &&
        cloudinaryPathIsInFolder(asset?.public_id, expectedFolder);
    if (!isExpectedFolder) {
      throw providerError(
        "Cloudinary stored the image outside the authorized Media folder.",
        "CLOUDINARY_MEDIA_FOLDER_MISMATCH",
      );
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
      await storageQuota.transitionProviderUpload({
        provider: "cloudinary",
        uploadId,
        fromStatuses: ["committing"],
        status: "committed",
        assetId: publicId,
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
        await storageQuota.transitionProviderUpload({
          provider: "cloudinary",
          uploadId,
          fromStatuses: ["committing"],
          status: "cancelled",
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

  const cancelCloudinaryUpload = async ({ churchId, uploadId }) => {
    churchId = requiredString(churchId, "Church ID");
    uploadId = requiredString(uploadId, "Upload ID");
    const intent = await storageQuota.getProviderUpload({
      provider: "cloudinary",
      uploadId,
    });
    if (!intent) return { cancelled: true };
    if (intent.churchId !== churchId) {
      const error = new Error("That upload does not belong to this church.");
      error.statusCode = 403;
      error.code = "CLOUDINARY_MEDIA_OWNERSHIP_MISMATCH";
      throw error;
    }
    if (intent.status === "committed") return { cancelled: false, committed: true };
    const claimed = await storageQuota.transitionProviderUpload({
      provider: "cloudinary",
      uploadId,
      fromStatuses: ["waiting", "cancelling", "cancelled"],
      status: "cancelling",
    });
    if (!claimed || claimed.churchId !== churchId) {
      const error = new Error("That upload could not be cancelled safely.");
      error.statusCode = 409;
      throw error;
    }
    if (claimed.status === "committing" || claimed.status === "committed") {
      if (claimed.status === "committed") {
        return { cancelled: false, committed: true };
      }
      const error = new Error("The image is being saved and could not be cancelled yet.");
      error.statusCode = 409;
      error.code = "CLOUDINARY_UPLOAD_COMMIT_IN_PROGRESS";
      throw error;
    }
    const publicId = intent.assetId;
    try {
      await getCloudinaryAsset(publicId);
    } catch (error) {
      if (error?.http_code === 404 || error?.response?.status === 404) {
        await storageQuota.transitionProviderUpload({
          provider: "cloudinary",
          uploadId,
          fromStatuses: ["cancelling"],
          status: "cancelled",
        });
        return { cancelled: true };
      }
      throw error;
    }
    const result = await cloudinaryClient.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true,
    });
    if (result?.result !== "ok" && result?.result !== "not found") {
      throw new Error("Cloudinary did not confirm image cleanup.");
    }
    await storageQuota.transitionProviderUpload({
      provider: "cloudinary",
      uploadId,
      fromStatuses: ["cancelling"],
      status: "cancelled",
    });
    return { cancelled: true };
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

  const cancelMuxUpload = async ({ churchId, uploadId }) => {
    churchId = requiredString(churchId, "Church ID");
    uploadId = requiredString(uploadId, "Upload ID");
    const mux = getMuxClient?.();
    if (!mux) throw new Error("Mux is not configured.");
    const verifyOwnership = (upload) => {
      if (upload.new_asset_settings?.meta?.creator_id !== churchId) {
        const error = new Error("That upload does not belong to this church.");
        error.statusCode = 403;
        throw error;
      }
    };
    let upload = await mux.video.uploads.retrieve(uploadId);
    verifyOwnership(upload);
    if (upload.asset_id) return { cancelled: false, assetId: upload.asset_id };
    if (typeof mux.video.uploads.cancel !== "function") {
      throw new Error("Mux could not confirm that the upload was cancelled.");
    }
    await mux.video.uploads.cancel(uploadId);
    upload = await mux.video.uploads.retrieve(uploadId);
    verifyOwnership(upload);
    if (upload.asset_id) return { cancelled: false, assetId: upload.asset_id };
    if (upload.status !== "cancelled" && upload.status !== "errored") {
      throw new Error("Mux could not confirm that the upload was cancelled.");
    }
    return { cancelled: true };
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
    createCloudinaryImageUpload,
    commitCloudinaryImage,
    cancelCloudinaryUpload,
    createMuxUpload,
    cancelMuxUpload,
    getMuxUpload,
    getMuxAsset,
    deleteCloudinaryImage,
    deleteMuxAsset,
  };
};
