import type { MediaType } from "../../types";
import { getMediaLibraryOrigin } from "./mediaLibraryOrigin";

export const getLocalMediaOwnerDeviceId = (
  media: Pick<MediaType, "localImage" | "localVideoFile" | "localVideoInput">,
) =>
  media.localVideoInput?.ownerDeviceId ||
  media.localImage?.ownerDeviceId ||
  media.localVideoFile?.ownerDeviceId;

export const getLocalMediaOwnerLabel = (
  media: Pick<MediaType, "localImage" | "localVideoFile" | "localVideoInput">,
) =>
  media.localVideoInput?.ownerLabel ||
  media.localImage?.ownerLabel ||
  media.localVideoFile?.ownerLabel ||
  "the source device";

export const localMediaHasCloudCopy = (
  media: Pick<MediaType, "localImage" | "localVideoFile">,
) => Boolean(media.localImage?.cloudUrl || media.localVideoFile?.cloudUrl);

const isDeviceBoundLocalOrigin = (media: MediaType) => {
  const origin = getMediaLibraryOrigin(media);
  return origin === "local" || origin === "video-input";
};

/** Visible in Media unless the operator turns on Other devices. */
export const isLocalMediaVisibleByDefault = (
  media: MediaType,
  deviceId: string,
) => {
  if (!isDeviceBoundLocalOrigin(media)) return true;
  if (localMediaHasCloudCopy(media)) return true;
  const ownerId = getLocalMediaOwnerDeviceId(media);
  if (!ownerId) return true;
  return ownerId === deviceId;
};

export const canUploadLocalMediaToCloud = (
  media: MediaType,
  deviceId: string,
) => {
  if (getMediaLibraryOrigin(media) !== "local") return false;
  if (localMediaHasCloudCopy(media)) return false;
  if (!media.localImage && !media.localVideoFile) return false;
  return getLocalMediaOwnerDeviceId(media) === deviceId;
};

export const canRequestLocalMediaCloudUpload = (
  media: MediaType,
  deviceId: string,
) => {
  if (getMediaLibraryOrigin(media) !== "local") return false;
  if (localMediaHasCloudCopy(media)) return false;
  if (!media.localImage && !media.localVideoFile) return false;
  const ownerId = getLocalMediaOwnerDeviceId(media);
  return Boolean(ownerId && ownerId !== deviceId);
};

export const getNextOwnedCloudUploadPrompt = (
  list: MediaType[],
  deviceId: string,
) => {
  const pending = list.filter(
    (media) =>
      canUploadLocalMediaToCloud(media, deviceId) &&
      Boolean(media.cloudUploadRequest),
  );
  pending.sort((a, b) =>
    (a.cloudUploadRequest?.requestedAt || "").localeCompare(
      b.cloudUploadRequest?.requestedAt || "",
    ),
  );
  return pending[0];
};
