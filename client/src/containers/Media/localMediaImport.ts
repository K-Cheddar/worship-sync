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
  readVideoMetadata,
  saveLocalVideoFile,
  validateLocalVideoFile,
} from "../../utils/localVideoFileAssets";
import { detectFileType } from "./utils/fileUtils";

export const createLocalMediaFromFile = async (
  file: File,
  workspaceId: string,
  storagePolicy: LocalAssetStoragePolicy = "local-only",
): Promise<MediaType> => {
  if (detectFileType(file) === "video") {
    return createLocalVideoMedia(file, workspaceId, storagePolicy);
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
): Promise<MediaType> => {
  const error = validateLocalVideoFile(file);
  if (error) throw new Error(error);
  const metadata = await readVideoMetadata(file);
  const assetId = `local_video_${generateRandomId()}`;
  const now = new Date().toISOString();
  await saveLocalVideoFile({
    id: assetId,
    workspaceId,
    blob: file,
    fileName: file.name,
    contentType: file.type,
    size: file.size,
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
    createdAt: now,
  });
  return {
    path: "",
    createdAt: now,
    updatedAt: now,
    format: file.type.replace("video/", "") || "video",
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
      contentType: file.type,
      storagePolicy,
      audioEnabled: true,
    },
  };
};
