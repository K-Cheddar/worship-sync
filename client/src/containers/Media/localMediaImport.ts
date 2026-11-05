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
  deleteLocalVideoThumbnail,
  getLocalVideoContentType,
  readVideoMetadataFromLocalAsset,
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

const MAX_DOWNLOADED_THUMBNAIL_BYTES = 2 * 1024 * 1024;

const decodeDownloadedVideoThumbnail = (dataUrl: string | undefined) => {
  if (!dataUrl || dataUrl.length > MAX_DOWNLOADED_THUMBNAIL_BYTES * 1.4) return undefined;
  const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match || Math.floor(match[2].length * 3 / 4) > MAX_DOWNLOADED_THUMBNAIL_BYTES) return undefined;
  try {
    const mime = `image/${match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase()}`;
    const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
    const isJpeg = mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = mime === "image/png" && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    const isWebp = mime === "image/webp" && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (!isJpeg && !isPng && !isWebp) return undefined;
    return new Blob([bytes], { type: mime });
  } catch {
    return undefined;
  }
};

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
  thumbnail,
  storagePolicy,
  folderId,
}: {
  asset: ElectronLocalAsset;
  workspaceId: string;
  displayName: string;
  duration: number;
  thumbnail?: string;
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
  const localVideo = {
    id: asset.assetId,
    workspaceId,
    fileName,
    contentType: "video/mp4",
    size: asset.size,
    width: asset.width,
    height: asset.height,
    duration,
    createdAt: now,
  };
  const thumbnailBlob = decodeDownloadedVideoThumbnail(thumbnail);
  await saveLocalVideoFile(localVideo, {
    thumbnailBlob,
    deferThumbnail: true,
  });
  const contentRevision = asset.contentHash || asset.updatedAt || now;
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
      storageMode: asset.storageMode === "linked" ? "linked" : "managed",
      ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
      ownerDeviceId: getOrCreateDeviceId(),
      ownerLabel: getTrustedDeviceLabel(),
      fileName,
      contentType: "video/mp4",
      storagePolicy,
      audioEnabled: true,
    },
  };
};

/** Add a native linked video to the shared Media Library and playback path. */
export const createLocalMediaFromLinkedVideo = async ({
  asset,
  workspaceId,
  displayName,
  folderId,
}: {
  asset: ElectronLocalAsset;
  workspaceId: string;
  displayName?: string;
  folderId?: string | null;
}): Promise<MediaType> => {
  if (
    asset.kind !== "video" || asset.storageMode !== "linked" ||
    !asset.assetId || !asset.url || !Number.isFinite(asset.size) || asset.size <= 0
  ) {
    throw new Error("The linked video details are invalid.");
  }
  let metadata: { width: number; height: number; duration: number };
  try {
    metadata = await readVideoMetadataFromLocalAsset(asset.url);
  } catch (error) {
    throw new LocalVideoPlaybackError(error);
  }
  const now = asset.createdAt || new Date().toISOString();
  const name = normalizeMediaLibraryDisplayName(
    displayName || asset.fileName.replace(/\.[^.]+$/, ""),
  ) || "Linked video";
  const contentRevision = asset.contentHash || asset.updatedAt || now;
  await deleteLocalVideoThumbnail(asset.assetId);
  await saveLocalVideoFile(
    {
      id: asset.assetId,
      workspaceId,
      fileName: asset.fileName,
      contentType: asset.contentType,
      size: asset.size,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      createdAt: now,
    },
    { deferThumbnail: true },
  );
  return {
    path: "",
    createdAt: now,
    updatedAt: now,
    format: asset.contentType.replace("video/", "") || "video",
    height: metadata.height,
    width: metadata.width,
    name,
    publicId: asset.assetId,
    type: "video",
    id: asset.assetId,
    background: buildLocalVideoFileUrl(asset.assetId),
    thumbnail: "",
    placeholderImage: "",
    duration: metadata.duration,
    hasAudio: true,
    source: "local",
    folderId: folderId ?? null,
    localVideoFile: {
      id: asset.assetId,
      contentRevision,
      storageMode: "linked",
      contentHash: asset.contentHash,
      ownerDeviceId: getOrCreateDeviceId(),
      ownerLabel: getTrustedDeviceLabel(),
      fileName: asset.fileName,
      contentType: asset.contentType,
      storagePolicy: "local-only",
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
      storageMode: "managed",
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
