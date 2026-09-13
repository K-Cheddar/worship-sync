import type { LocalAssetStoragePolicy, MediaType } from "../../types";
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
import { detectFileType } from "./utils/fileUtils";

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
  } = {},
): Promise<MediaType> => {
  if (detectFileType(file) === "video") {
    return createLocalVideoMedia(file, workspaceId, storagePolicy, options);
  }
  return createLocalImageMedia(file, workspaceId, storagePolicy);
};

const createLocalImageMedia = async (
  file: File,
  workspaceId: string,
  storagePolicy: LocalAssetStoragePolicy,
): Promise<MediaType> => {
  const error = validateLocalImageFile(file);
  if (error) throw new Error(error);
  const dimensions = await readImageDimensions(file);
  const assetId = `local_image_${generateRandomId()}`;
  const now = new Date().toISOString();
  await saveLocalImage({
    id: assetId,
    workspaceId,
    blob: file,
    fileName: file.name,
    contentType: file.type,
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
    format: file.type.replace("image/", "") || "image",
    height: dimensions.height,
    width: dimensions.width,
    name: file.name,
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
      contentType: file.type,
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
    name: file.name,
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
