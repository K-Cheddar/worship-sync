import { useCallback, useContext, useMemo, useState } from "react";
import Button from "../Button/Button";
import Modal from "../Modal/Modal";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import { updateMediaItemFields } from "../../store/mediaSlice";
import type { RootState } from "../../store/store";
import { useLocalMediaCloudShare } from "../../containers/Media/localMediaCloudShare";
import { getNextOwnedCloudUploadPrompt } from "../../containers/Media/mediaLibraryLocalAvailability";
import { truncatedMediaToastLabel } from "../../containers/Media/mediaLibraryMeta";

const LocalMediaCloudShareManager = () => {
  const dispatch = useDispatch();
  const { isGuestSession = false } = useContext(ControllerInfoContext) || {};
  const mediaList = useSelector((state: RootState) => state.media.list);
  const { deviceId, uploadOwnedLocalMedia } = useLocalMediaCloudShare();
  const [isUploading, setIsUploading] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const pending = useMemo(() => {
    if (isGuestSession) return undefined;
    const next = getNextOwnedCloudUploadPrompt(mediaList, deviceId);
    if (!next) return undefined;
    const requestKey = `${next.id}:${next.cloudUploadRequest?.requestedAt || ""}`;
    if (requestKey === dismissedKey) return undefined;
    return next;
  }, [deviceId, dismissedKey, isGuestSession, mediaList]);

  const requesterLabel =
    pending?.cloudUploadRequest?.requestedByLabel?.trim() || "Another device";
  const mediaLabel = pending ? truncatedMediaToastLabel(pending) : "";

  const dismissRequest = useCallback(() => {
    if (!pending) return;
    setDismissedKey(
      `${pending.id}:${pending.cloudUploadRequest?.requestedAt || ""}`,
    );
    dispatch(
      updateMediaItemFields({
        id: pending.id,
        patch: {
          updatedAt: new Date().toISOString(),
          cloudUploadRequest: null,
        },
      }),
    );
  }, [dispatch, pending]);

  const handleUpload = useCallback(async () => {
    if (!pending || isUploading) return;
    setIsUploading(true);
    try {
      await uploadOwnedLocalMedia(pending);
    } finally {
      setIsUploading(false);
    }
  }, [isUploading, pending, uploadOwnedLocalMedia]);

  if (!pending) return null;

  return (
    <Modal
      isOpen
      onClose={dismissRequest}
      title="Upload this file?"
      size="sm"
      description={`${requesterLabel} asked to upload ${mediaLabel} so other devices can use it.`}
    >
      <p className="text-sm text-gray-200">
        {requesterLabel} asked to upload "{mediaLabel}" so other devices can use
        it.
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          onClick={dismissRequest}
          disabled={isUploading}
        >
          Not now
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            void handleUpload();
          }}
          disabled={isUploading}
        >
          {isUploading ? "Uploading..." : "Upload"}
        </Button>
      </div>
    </Modal>
  );
};

export default LocalMediaCloudShareManager;
