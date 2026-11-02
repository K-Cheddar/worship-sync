import type { LocalAssetStoragePolicy, MediaType } from "../../types";
import type { ElectronLocalAsset } from "../../types/electron";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import { getTrustedDeviceLabel } from "../../utils/deviceInfo";
import generateRandomId from "../../utils/generateRandomId";
import {
  buildLocalImageUrl,
  readImageDimensions,
  saveLocalImage,
  validateLocalImageFile,
} from "../../utils/localImageAssets";
import {
  buildLocalVideoFileUrl,
  getLocalVideoContentType,
  readVideoMetadata,
  saveLocalVideoFile,
  validateLocalVideoFile,
} from "../../utils/localVideoFileAssets";
import { getImageContentType } from "../../utils/mediaFileTypes";
import { detectFileType } from "./utils/fileUtils";
import { normalizeMediaLibraryDisplayName } from "./mediaLibraryMeta";

export class LocalImagePlaybackError extends Error {
  constructor(cause: unknown) {
    super(
      "This image cannot be displayed on this device. You can convert it for offline playback.",
      { cause },
    );
    this.name = "LocalImagePlaybackError";
  }
}

export class LocalVideoPlaybackError extends Error {
  constructor(cause: unknown) {
    super(
      "This video cannot be played on this device. You can convert it for offline playback.",
      { cause },
    );
    this.name = "LocalVideoPlaybackError";
  }
}

export const createLocalMediaFromFile = async (
  file: File,
  workspaceId: string,
  storagePolicy: LocalAssetStoragePolicy = "local-only",
  options: {
    allowCloudPlaybackFallback?: boolean;
    importBytes?: boolean;
    displayName?: string;
  } = {},
): Promise<MediaType> => {
  if (detectFileType(file) === "video") {
    return createLocalVideoMedia(file, workspaceId, storagePolicy, options);
  }
  return createLocalImageMedia(
    file,
    workspaceId,
    storagePolicy,
    options.displayName,
  );
};

/** Register a completed native download without loading its video bytes in React. */
export const createLocalMediaFromDownloadedVideo = async ({
  asset,
  workspaceId,
  displayName,
  duration,
  storagePolicy,
  folderId,
}: {
  asset: ElectronLocalAsset;
  workspaceId: string;
  displayName: string;
  duration: number;
  storagePolicy: LocalAssetStoragePolicy;
  folderId?: string | null;
}): Promise<MediaType> => {
  if (
    asset.kind !== "video" || asset.contentType !== "video/mp4" ||
    !asset.assetId.startsWith("local_video_download_") ||
    !Number.isFinite(asset.size) || asset.size <= 0 ||
    !Number.isFinite(asset.width) || !asset.width || asset.width <= 0 ||
    !Number.isFinite(asset.height) || !asset.height || asset.height <= 0 ||
    !Number.isFinite(duration) || duration <= 0
  ) {
    throw new Error("The downloaded video details are invalid.");
  }
  if (!window.electronAPI?.getLocalAsset) {
    throw new Error("Downloaded videos can only be imported in the desktop app.");
  }
  const now = asset.createdAt || new Date().toISOString();
  const fileName = `${normalizeMediaLibraryDisplayName(displayName) || "Downloaded video"}.mp4`;
  await saveLocalVideoFile({
    id: asset.assetId,
    workspaceId,
    fileName,
    contentType: "video/mp4",
    size: asset.size,
    width: asset.width,
    height: asset.height,
    duration,
    createdAt: now,
  });
  const contentRevision = asset.updatedAt || now;
  return {
    path: "",
    createdAt: now,
    updatedAt: now,
    format: "mp4",
    height: asset.height,
    width: asset.width,
    name: normalizeMediaLibraryDisplayName(displayName) || "Downloaded video",
    publicId: asset.assetId,
    type: "video",
    id: asset.assetId,
    background: buildLocalVideoFileUrl(asset.assetId),
    thumbnail: "",
    placeholderImage: "",
    duration,
    hasAudio: true,
    source: "local",
    folderId: folderId ?? null,
    localVideoFile: {
      id: asset.assetId,
      contentRevision,
      ownerDeviceId: getOrCreateDeviceId(),
      ownerLabel: getTrustedDeviceLabel(),
      fileName,
      contentType: "video/mp4",
      storagePolicy,
      audioEnabled: true,
    },
  };
};

const createLocalImageMedia = async (
  file: File,
  workspaceId: string,
  storagePolicy: LocalAssetStoragePolicy,
  displayName?: string,
): Promise<MediaType> => {
  const error = validateLocalImageFile(file);
  if (error) throw new Error(error);
  let dimensions: { width: number; height: number };
  try {
    dimensions = await readImageDimensions(file);
  } catch (error) {
    throw new LocalImagePlaybackError(error);
  }
  const assetId = `local_image_${generateRandomId()}`;
  const now = new Date().toISOString();
  const contentType = getImageContentType(file);
  await saveLocalImage({
    id: assetId,
    workspaceId,
    blob: file,
    fileName: file.name,
    contentType,
    size: file.size,
    width: dimensions.width,
    height: dimensions.height,
    createdAt: now,
  });
  const localUrl = buildLocalImageUrl(assetId);
  return {
    path: "",
    createdAt: now,
    updatedAt: now,
    format: contentType.replace("image/", "") || "image",
    height: dimensions.height,
    width: dimensions.width,
    name: normalizeMediaLibraryDisplayName(displayName ?? file.name),
    publicId: assetId,
    type: "image",
    id: assetId,
    background: localUrl,
    thumbnail: localUrl,
    source: "local",
    localImage: {
      id: assetId,
      contentRevision: now,
      ownerDeviceId: getOrCreateDeviceId(),
      ownerLabel: getTrustedDeviceLabel(),
      fileName: file.name,
      contentType,
      storagePolicy,
    },
  };
};

const createLocalVideoMedia = async (
  file: File,
  workspaceId: string,
  storagePolicy: LocalAssetStoragePolicy,
  options: {
    allowCloudPlaybackFallback?: boolean;
    importBytes?: boolean;
    displayName?: string;
  },
): Promise<MediaType> => {
  const error = validateLocalVideoFile(file);
  if (error) throw new Error(error);
  let metadata: { width: number; height: number; duration: number };
  let preferCloudPlayback = false;
  try {
    metadata = await readVideoMetadata(file);
  } catch (error) {
    if (!options.allowCloudPlaybackFallback) {
      throw new LocalVideoPlaybackError(error);
    }
    // Mux can ingest codecs that Chromium/Electron cannot decode locally. Keep
    // the original file, then switch this media item to Mux HLS after the
    // cloud upload finishes. These values are replaced by playable cloud data
    // where available; they only keep the local record structurally valid.
    metadata = { width: 1920, height: 1080, duration: 0 };
    preferCloudPlayback = true;
  }
  const assetId = `local_video_${generateRandomId()}`;
  const now = new Date().toISOString();
  const contentType = getLocalVideoContentType(file);
  const localVideo = {
    id: assetId,
    workspaceId,
    blob: file,
    fileName: file.name,
    contentType,
    size: file.size,
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
    createdAt: now,
  };
  if (options.importBytes) {
    await saveLocalVideoFile(localVideo, { importBytes: true });
  } else {
    await saveLocalVideoFile(localVideo);
  }
  return {
    path: "",
    createdAt: now,
    updatedAt: now,
    format: contentType.replace("video/", "") || "video",
    height: metadata.height,
    width: metadata.width,
    name: normalizeMediaLibraryDisplayName(options.displayName ?? file.name),
    publicId: assetId,
    type: "video",
    id: assetId,
    background: buildLocalVideoFileUrl(assetId),
    thumbnail: "",
    placeholderImage: "",
    duration: metadata.duration,
    hasAudio: true,
    source: "local",
    localVideoFile: {
      id: assetId,
      contentRevision: now,
      ownerDeviceId: getOrCreateDeviceId(),
      ownerLabel: getTrustedDeviceLabel(),
      fileName: file.name,
      contentType,
      storagePolicy,
      audioEnabled: true,
      ...(preferCloudPlayback ? { preferCloudPlayback: true } : {}),
    },
  };
};
