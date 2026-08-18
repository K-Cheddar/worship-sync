import { useCallback, useContext, useState } from "react";
import { CloudUpload } from "lucide-react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useToast } from "../../context/toastContext";
import { useDispatch } from "../../hooks";
import { updateMediaItemFields } from "../../store/mediaSlice";
import type { MediaCloudUploadRequest, MediaType } from "../../types";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import { getTrustedDeviceLabel } from "../../utils/deviceInfo";
import { enqueueLocalImageUpload } from "../../utils/localImageUploadQueue";
import { getLocalVideoFileBlob } from "../../utils/localVideoFileAssets";
import type { MuxUploadResult } from "./MediaUploadInput.types";
import type { MediaLibraryBarAction } from "./mediaLibraryActions";
import {
  canRequestLocalMediaCloudUpload,
  canUploadLocalMediaToCloud,
  getLocalMediaOwnerLabel,
} from "./mediaLibraryLocalAvailability";
import { truncatedMediaToastLabel } from "./mediaLibraryMeta";
import { uploadVideoToMux } from "./utils/muxUpload";

const uploadsInFlight = new Set<string>();

export const buildLocalVideoCloudSharePatch = (
  media: MediaType,
  result: MuxUploadResult,
): Partial<MediaType> => {
  if (!media.localVideoFile) return { cloudUploadRequest: null };
  return {
    updatedAt: new Date().toISOString(),
    format: "m3u8",
    background: result.playbackUrl,
    thumbnail: result.thumbnailUrl,
    placeholderImage: result.thumbnailUrl,
    muxPlaybackId: result.playbackId,
    muxAssetId: result.assetId,
    cloudUploadRequest: null,
    localVideoFile: {
      ...media.localVideoFile,
      storagePolicy: "local-and-cloud",
      cloudUrl: result.playbackUrl,
      cloudMediaId: result.assetId,
    },
  };
};

export const uploadOwnedLocalVideoToCloud = async (media: MediaType) => {
  const assetId = media.localVideoFile?.id;
  if (!assetId) {
    throw new Error("This video is not saved on this device.");
  }
  const fileParts = await getLocalVideoFileBlob(assetId);
  if (!fileParts) {
    throw new Error("This video is not available on this device.");
  }
  const file = new File([fileParts.blob], fileParts.fileName, {
    type: fileParts.contentType || "video/mp4",
  });
  const result = await uploadVideoToMux(file);
  return buildLocalVideoCloudSharePatch(media, result);
};

export const createMediaCloudUploadRequest = (
  deviceId: string,
  label: string,
): MediaCloudUploadRequest => ({
  requestedAt: new Date().toISOString(),
  requestedByDeviceId: deviceId,
  requestedByLabel: label,
});

export const getLocalMediaCloudShareBarAction = ({
  media,
  deviceId,
  isGuest,
  isUploading,
  onUpload,
  onRequest,
}: {
  media: MediaType;
  deviceId: string;
  isGuest: boolean;
  isUploading?: boolean;
  onUpload: () => void;
  onRequest: () => void;
}): MediaLibraryBarAction | null => {
  if (isGuest) return null;
  if (canUploadLocalMediaToCloud(media, deviceId)) {
    return {
      id: "upload-local-media-cloud",
      label: isUploading ? "Uploading..." : "Upload to cloud",
      icon: <CloudUpload className="size-4" />,
      disabled: isUploading,
      onClick: onUpload,
    };
  }
  if (canRequestLocalMediaCloudUpload(media, deviceId)) {
    const alreadyAsked = Boolean(media.cloudUploadRequest);
    return {
      id: "ask-local-media-cloud-upload",
      label: alreadyAsked ? "Asked to upload" : "Ask to upload",
      icon: <CloudUpload className="size-4" />,
      disabled: alreadyAsked,
      onClick: onRequest,
    };
  }
  return null;
};

export function useLocalMediaCloudShare() {
  const dispatch = useDispatch();
  const { showToast } = useToast();
  const { churchId = "", uploadPreset = "bpqu4ma5" } =
    useContext(GlobalInfoContext) || {};
  const { isGuestSession = false } = useContext(ControllerInfoContext) || {};
  const deviceId = getOrCreateDeviceId();
  const [uploadingMediaId, setUploadingMediaId] = useState<string | null>(null);

  const uploadOwnedLocalMedia = useCallback(
    async (media: MediaType) => {
      if (isGuestSession) {
        showToast(
          "Guest mode uses sample media only. Sign in to upload.",
          "error",
        );
        return;
      }
      if (!canUploadLocalMediaToCloud(media, deviceId)) {
        showToast(
          "Upload this file from the device that holds it.",
          "error",
        );
        return;
      }
      if (uploadsInFlight.has(media.id)) {
        showToast("This file is already uploading.", "warning");
        return;
      }
      const label = truncatedMediaToastLabel(media);

      if (media.localImage) {
        if (!churchId) {
          showToast("Could not start the upload. Try again.", "error");
          return;
        }
        uploadsInFlight.add(media.id);
        setUploadingMediaId(media.id);
        try {
          await enqueueLocalImageUpload({
            assetId: media.localImage.id,
            itemId: "",
            workspaceId: churchId,
            uploadPreset,
          });
          dispatch(
            updateMediaItemFields({
              id: media.id,
              patch: {
                updatedAt: new Date().toISOString(),
                cloudUploadRequest: null,
              },
            }),
          );
          showToast(`Uploading ${label} to the Media cloud.`, "success");
        } catch {
          showToast(`Could not upload ${label}. Try again.`, "error");
        } finally {
          uploadsInFlight.delete(media.id);
          setUploadingMediaId(null);
        }
        return;
      }

      uploadsInFlight.add(media.id);
      setUploadingMediaId(media.id);
      try {
        const patch = await uploadOwnedLocalVideoToCloud(media);
        dispatch(updateMediaItemFields({ id: media.id, patch }));
        showToast(
          `${label} is available in Media and on other devices.`,
          "success",
        );
      } catch {
        showToast(`Could not upload ${label}. Try again.`, "error");
      } finally {
        uploadsInFlight.delete(media.id);
        setUploadingMediaId(null);
      }
    },
    [
      churchId,
      deviceId,
      dispatch,
      isGuestSession,
      showToast,
      uploadPreset,
    ],
  );

  const requestLocalMediaCloudUpload = useCallback(
    (media: MediaType) => {
      if (isGuestSession) {
        showToast(
          "Guest mode uses sample media only. Sign in to upload.",
          "error",
        );
        return;
      }
      if (!canRequestLocalMediaCloudUpload(media, deviceId)) {
        showToast("This file cannot be uploaded from here.", "error");
        return;
      }
      if (media.cloudUploadRequest) {
        showToast(
          `Already asked ${getLocalMediaOwnerLabel(media)} to upload this file.`,
          "success",
        );
        return;
      }
      dispatch(
        updateMediaItemFields({
          id: media.id,
          patch: {
            updatedAt: new Date().toISOString(),
            cloudUploadRequest: createMediaCloudUploadRequest(
              deviceId,
              getTrustedDeviceLabel(),
            ),
          },
        }),
      );
      showToast(
        `Asked ${getLocalMediaOwnerLabel(media)} to upload this file.`,
        "success",
      );
    },
    [deviceId, dispatch, isGuestSession, showToast],
  );

  const getBarAction = useCallback(
    (media: MediaType, selectedCount: number): MediaLibraryBarAction | null => {
      if (selectedCount !== 1) return null;
      return getLocalMediaCloudShareBarAction({
        media,
        deviceId,
        isGuest: isGuestSession,
        isUploading: uploadingMediaId === media.id,
        onUpload: () => {
          void uploadOwnedLocalMedia(media);
        },
        onRequest: () => requestLocalMediaCloudUpload(media),
      });
    },
    [
      deviceId,
      isGuestSession,
      requestLocalMediaCloudUpload,
      uploadOwnedLocalMedia,
      uploadingMediaId,
    ],
  );

  return {
    deviceId,
    getBarAction,
    uploadOwnedLocalMedia,
  };
}
