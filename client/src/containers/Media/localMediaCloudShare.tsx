import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useToast } from "../../context/toastContext";
import { useDispatch } from "../../hooks";
import { updateMediaItemFields } from "../../store/mediaSlice";
import type { MediaCloudUploadRequest, MediaType } from "../../types";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import { getTrustedDeviceLabel } from "../../utils/deviceInfo";
import { cancelLocalImageUpload, enqueueLocalImageUpload, getLocalImageUploadJob, retryLocalImageUpload, retryLocalImageUploadCancellation, waitForLocalImageUpload } from "../../utils/localImageUploadQueue";
import { claimMediaUpload, isMediaUploadClaimed, type MediaUploadClaim } from "../../utils/mediaOperationClaims";
import { useOptionalTransferActions } from "../../context/transferContext";
import type { Transfer, TransferFileActivity } from "../../context/transferModel";
import { deleteChurchMuxAsset } from "../../api/providerStorage";
import { getLocalVideoFileBlob } from "../../utils/localVideoFileAssets";
import type { MuxUploadResult } from "./MediaUploadInput.types";
import type { MediaLibraryBarAction } from "./mediaLibraryActions";
import {
  canRequestLocalMediaCloudUpload,
  canUploadLocalMediaToCloud,
  getLocalMediaOwnerLabel,
  localMediaHasCloudCopy,
} from "./mediaLibraryLocalAvailability";
import type { MuxUploadCallbacks } from "./utils/muxUpload";
import { uploadVideoToMux } from "./utils/muxUpload";

export const buildLocalVideoCloudSharePatch = (
  media: MediaType,
  result: MuxUploadResult,
  churchId?: string,
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
    ...(churchId ? { providerStorage: {
      provider: "mux",
      assetId: result.assetId,
      churchId,
      permanent: true,
      durationSeconds: result.durationSeconds,
    } } : {}),
    cloudUploadRequest: null,
    localVideoFile: {
      ...media.localVideoFile,
      storagePolicy: "local-and-cloud",
      cloudUrl: result.playbackUrl,
      cloudMediaId: result.assetId,
    },
  };
};

export const uploadOwnedLocalVideoToCloud = async (
  media: MediaType,
  churchId: string,
) => {
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
  const result = await uploadVideoToMux(file, {
    churchId,
    mediaId: media.id,
    title: media.name,
  });
  return buildLocalVideoCloudSharePatch(media, result, churchId);
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
  mediaItems = [media],
  deviceId,
  isGuest,
  isUploading,
  onUpload,
  onRequest,
}: {
  media: MediaType;
  mediaItems?: MediaType[];
  deviceId: string;
  isGuest: boolean;
  isUploading?: boolean;
  onUpload: (items: MediaType[]) => void;
  onRequest: () => void;
}): MediaLibraryBarAction | null => {
  if (isGuest) return null;
  if (mediaItems.length === 1 && canRequestLocalMediaCloudUpload(media, deviceId)) {
    const alreadyAsked = Boolean(media.cloudUploadRequest);
    return {
      id: "ask-local-media-cloud-upload",
      label: alreadyAsked ? "Asked to upload" : "Ask to upload",
      icon: <CloudUpload className="size-4" />,
      disabled: alreadyAsked,
      onClick: onRequest,
    };
  }

  const ownerLocal = mediaItems.filter((item) => canUploadLocalMediaToCloud(item, deviceId));
  const busy = ownerLocal.filter((item) => isMediaUploadClaimed(item.id) || (mediaItems.length === 1 && isUploading));
  const eligible = ownerLocal.filter((item) => !busy.includes(item));
  if (eligible.length === 0 && busy.length === 0) return null;
  const alreadyCloud = mediaItems.filter((item) => localMediaHasCloudCopy(item));
  const otherDevice = mediaItems.filter((item) => canRequestLocalMediaCloudUpload(item, deviceId));
  const unsupported = mediaItems.length - ownerLocal.length - alreadyCloud.length - otherDevice.length;
  const parts = [
    eligible.length ? `${eligible.length} ready to upload from this device` : "No files are ready to upload",
    alreadyCloud.length ? `${alreadyCloud.length} already have a cloud copy` : "",
    otherDevice.length ? `${otherDevice.length} held on another device` : "",
    busy.length ? `${busy.length} already uploading` : "",
    unsupported > 0 ? `${unsupported} are not owner-local files` : "",
  ].filter(Boolean);
  const isMultiple = mediaItems.length > 1;
  return {
    id: "upload-local-media-cloud",
    label: eligible.length === 0
      ? "Uploading selected items…"
      : isMultiple
        ? `Upload ${eligible.length} eligible ${eligible.length === 1 ? "item" : "items"} to cloud`
        : "Upload to cloud",
    icon: <CloudUpload className="size-4" />,
    disabled: eligible.length === 0,
    supportingText: parts.join(" · "),
    onClick: () => onUpload(eligible),
  };
};

type CloudShareFile = {
  media: MediaType;
  status: TransferFileActivity["status"];
  progress: number | null;
  phase: string;
  error?: string;
  retryCleanup?: () => Promise<void>;
};

type CloudShareBatch = {
  id: string;
  database: unknown;
  churchId: string;
  files: CloudShareFile[];
  skipped: string;
  cancelled: boolean;
  stopping?: boolean;
  active: boolean;
  ownerActive: boolean;
  cancelledMediaIds: Set<string>;
  xhrs: Map<string, XMLHttpRequest>;
  cancelFiles: Map<string, () => Promise<void>>;
  claims: Map<string, MediaUploadClaim>;
  unregister: Array<() => void>;
  completion?: Promise<void>;
};

export function useLocalMediaCloudShare(onStorageUsageChanged?: () => void) {
  const dispatch = useDispatch();
  const { showToast } = useToast();
  const { churchId = "", uploadPreset = "bpqu4ma5" } =
    useContext(GlobalInfoContext) || {};
  const { db, isGuestSession = false } = useContext(ControllerInfoContext) || {};
  const activeScopeRef = useRef({ db, churchId });
  activeScopeRef.current = { db, churchId };
  const deviceId = getOrCreateDeviceId();
  const actions = useOptionalTransferActions();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const batches = useRef(new Map<string, CloudShareBatch>());
  const [uploadingMediaIds, setUploadingMediaIds] = useState<Set<string>>(new Set());

  useEffect(() => () => {
    for (const batch of batches.current.values()) {
      batch.ownerActive = false;
      batch.unregister.splice(0).forEach((unregister) => unregister());
      const transfer = actionsRef.current?.getTransfer(batch.id);
      if (transfer) {
        actionsRef.current?.updateTransfer({
          ...transfer,
          status: transfer.status === "active" ? "failed" : transfer.status,
          phase: transfer.status === "active"
            ? { key: "failed", label: "Media closed while upload was pending" }
            : transfer.phase,
          ...(transfer.status === "active"
            ? { error: { message: "Reopen Media to inspect the library and retry remaining work." } }
            : {}),
          canCancel: false,
          blocksUnload: false,
          actions: [],
        });
      }
    }
  }, []);

  const setBusy = useCallback((ids: string[], busy: boolean) => setUploadingMediaIds((current) => {
    const next = new Set(current);
    ids.forEach((id) => busy ? next.add(id) : next.delete(id));
    return next;
  }), []);

  const requestLocalMediaCloudUpload = useCallback(
    (media: MediaType) => {
      if (isGuestSession) {
        showToast("Guest mode uses sample media only. Sign in to upload.", "error");
        return;
      }
      if (!canRequestLocalMediaCloudUpload(media, deviceId)) {
        showToast("This file cannot be uploaded from here.", "error");
        return;
      }
      if (media.cloudUploadRequest) {
        showToast(`Already asked ${getLocalMediaOwnerLabel(media)} to upload this file.`, "success");
        return;
      }
      dispatch(updateMediaItemFields({
        id: media.id,
        patch: {
          updatedAt: new Date().toISOString(),
          cloudUploadRequest: createMediaCloudUploadRequest(deviceId, getTrustedDeviceLabel()),
        },
      }));
      showToast(`Asked ${getLocalMediaOwnerLabel(media)} to upload this file.`, "success");
    },
    [deviceId, dispatch, isGuestSession, showToast],
  );

  const uploadOwnedLocalMedia = useCallback(
    async (selected: MediaType | MediaType[]) => {
      const candidates = Array.isArray(selected) ? selected : [selected];
      if (isGuestSession) {
        showToast("Guest mode uses sample media only. Sign in to upload.", "error");
        return;
      }
      if (!churchId) {
        showToast("Could not start the upload. Try again.", "error");
        return;
      }
      const files = candidates
        .filter((media) => canUploadLocalMediaToCloud(media, deviceId) && !isMediaUploadClaimed(media.id))
        .map((media) => ({ media, status: "queued" as const, progress: 0, phase: "Queued" }));
      if (files.length === 0) return;
      const alreadyCloud = candidates.filter((media) => localMediaHasCloudCopy(media)).length;
      const remote = candidates.filter((media) => canRequestLocalMediaCloudUpload(media, deviceId)).length;
      const busyCount = candidates.filter((media) => isMediaUploadClaimed(media.id)).length;
      const unsupported = candidates.length - files.length - alreadyCloud - remote - busyCount;
      const skipped = [
        alreadyCloud ? `${alreadyCloud} already cloud-backed` : "",
        remote ? `${remote} on another device` : "",
        busyCount ? `${busyCount} already uploading` : "",
        unsupported > 0 ? `${unsupported} not eligible` : "",
      ].filter(Boolean).join(" · ");
      const id = `media-cloud-share-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      const batch: CloudShareBatch = {
        id,
        database: db,
        churchId,
        files,
        skipped,
        cancelled: false,
        stopping: false,
        active: true,
        ownerActive: true,
        cancelledMediaIds: new Set(),
        xhrs: new Map(),
        cancelFiles: new Map(),
        claims: new Map(),
        unregister: [],
      };
      batches.current.set(id, batch);
      const publish = (terminal?: Transfer["status"]) => {
        if (!batch.ownerActive) return;
        const complete = batch.files.filter((file) => file.status === "complete").length;
        const failed = batch.files.filter((file) => file.status === "failed");
        const cancelled = batch.files.filter((file) => file.status === "cancelled").length;
        const status: Transfer["status"] = terminal || "active";
        const measurable = batch.files.filter((file) => file.progress !== null);
        const progress = status === "complete" ? 100 : measurable.length
          ? measurable.reduce((total, file) => total + (file.progress || 0), 0) / batch.files.length
          : null;
        const transfer: Transfer = {
          id,
          type: "Media upload",
          name: files.length === 1 ? files[0].media.name : `Cloud upload · ${files.length} items`,
          status,
          progress,
          phase: { key: status, label: status === "complete" ? "Upload complete" : status === "partial" ? "Upload completed with errors" : status === "failed" ? "Upload failed" : status === "cancelled" ? "Upload cancelled" : batch.files.find((file) => file.status === "active")?.phase || "Uploading media", current: complete, total: files.length },
          detail: `${complete} of ${files.length} uploaded${failed.length ? ` · ${failed.length} failed` : ""}${cancelled ? ` · ${cancelled} cancelled` : ""}${batch.skipped ? ` · Skipped: ${batch.skipped}` : ""}`,
          ...(failed.length ? { error: { message: `${failed.length} ${failed.length === 1 ? "item" : "items"} failed to upload.` } } : {}),
          files: batch.files.map((file) => ({ id: file.media.id, name: file.media.name, status: file.status, progress: file.progress, phase: file.phase, ...(file.error ? { error: file.error } : {}) })),
          canCancel: status === "active" && !batch.stopping,
          blocksUnload: status === "active",
          actions: status === "active"
            ? [{ key: "cancel", label: batch.stopping ? "Cancelling…" : "Cancel upload", ...(batch.stopping ? { pending: true } : {}) }]
            : [
                ...(failed.some((file) => file.retryCleanup) ? [{ key: "retry-cleanup", label: "Retry cleanup" }] : []),
                ...(failed.length && !batch.cancelled ? [{ key: "retry-failed", label: "Retry failed files" }] : []),
                { key: "dismiss", label: "Dismiss" },
              ],
        };
        actions?.updateTransfer(transfer);
        return transfer;
      };
      const retryCleanup = async () => {
        for (const file of batch.files.filter((candidate) => candidate.retryCleanup)) {
          try {
            await file.retryCleanup?.();
            file.retryCleanup = undefined;
            file.error = "Upload failed. Cleanup succeeded; you can retry this file.";
          } catch (error) {
            file.error = error instanceof Error ? error.message : "Cleanup failed. Try again.";
          }
        }
        publish(batch.files.some((file) => file.status === "complete") ? "partial" : "failed");
      };
      const runBatch = async (retryFailedOnly = false) => {
        batch.cancelled = false;
        batch.active = true;
        const targets = batch.files.filter((file) => retryFailedOnly ? file.status === "failed" && !file.retryCleanup : file.status === "queued");
        targets.forEach((file) => { file.status = "queued"; file.progress = 0; file.error = undefined; });
        publish();
        let cursor = 0;
        const uploadOne = async (entry: CloudShareFile) => {
          const media = entry.media;
          const claim = claimMediaUpload(media.id);
          if (!claim) {
            entry.status = "failed";
            entry.error = "This item is already being changed.";
            publish();
            return;
          }
          batch.claims.set(media.id, claim);
          setBusy([media.id], true);
          let cancelMuxUpload: (() => Promise<void>) | undefined;
          const cancelOne = async () => {
            batch.cancelledMediaIds.add(media.id);
            batch.xhrs.get(media.id)?.abort();
            if (media.localVideoFile && cancelMuxUpload) {
              try { await cancelMuxUpload(); }
              catch (error) {
                const failure = error && typeof error === "object" ? error as { retryCleanup?: () => Promise<void> } : undefined;
                const retry = failure?.retryCleanup || cancelMuxUpload;
                claim.failCleanup(error instanceof Error ? error : new Error("Mux cleanup failed."), retry);
                entry.retryCleanup = retry;
                throw error;
              }
            }
            if (media.localImage) {
              try {
                await cancelLocalImageUpload(media.localImage.id);
              } catch (error) {
                const retry = () => retryLocalImageUploadCancellation(media.localImage!.id, churchId);
                claim.failCleanup(error instanceof Error ? error : new Error("Image cleanup failed."), retry);
                entry.retryCleanup = retry;
                throw error;
              }
            }
          };
          batch.cancelFiles.set(media.id, cancelOne);
          claim.setCancel(cancelOne);
          entry.status = "active";
          entry.phase = "Starting cloud upload";
          entry.progress = 0;
          publish();
          try {
            if (media.localImage) {
              const assetId = media.localImage.id;
              if (retryFailedOnly) {
                const job = await getLocalImageUploadJob(assetId);
                if (job?.status === "failed" && !job.cancelRequested) await retryLocalImageUpload(assetId);
              }
              if (!claim.isCurrent() || batch.cancelledMediaIds.has(media.id)) { entry.status = "cancelled"; return; }
              await enqueueLocalImageUpload({ assetId, itemId: "", workspaceId: churchId, uploadPreset, mediaId: media.id });
              if (!claim.isCurrent() || batch.cancelledMediaIds.has(media.id)) {
                try { await cancelLocalImageUpload(assetId); }
                catch (error) {
                  const retry = () => retryLocalImageUploadCancellation(assetId, churchId);
                  claim.failCleanup(error instanceof Error ? error : new Error("Image cleanup failed."), retry);
                  entry.retryCleanup = retry;
                  throw error;
                }
                entry.status = "cancelled";
                return;
              }
              await waitForLocalImageUpload(assetId, (state) => {
                entry.phase = state.phase;
                entry.progress = state.progress;
                if (state.status === "complete") entry.status = "complete";
                else if (state.status === "failed") { entry.status = "failed"; entry.error = state.error; }
                else if (state.status === "cancelled") entry.status = "cancelled";
                else entry.status = "active";
                publish();
              });
              if (!claim.isCurrent() || batch.cancelledMediaIds.has(media.id)) { entry.status = "cancelled"; return; }
              entry.status = "complete";
              entry.progress = 100;
              entry.phase = "Upload complete";
            } else if (media.localVideoFile) {
              const parts = await getLocalVideoFileBlob(media.localVideoFile.id);
              if (!parts) throw new Error("This video is not available on this device.");
              if (!claim.isCurrent() || batch.cancelledMediaIds.has(media.id)) { entry.status = "cancelled"; return; }
              const file = new File([parts.blob], parts.fileName, { type: parts.contentType || "video/mp4" });
              const callbacks: MuxUploadCallbacks = {
                onProgress: (value) => { entry.progress = Math.min(88, value * 0.88); entry.phase = "Uploading video"; publish(); },
                onStatusUpdate: (message) => { entry.phase = message; publish(); },
                isCancelled: () => batch.cancelled || batch.cancelledMediaIds.has(media.id),
                setXhr: (xhr) => batch.xhrs.set(media.id, xhr),
                setCancelUpload: (cancel) => { cancelMuxUpload = cancel; },
              };
              const result = await uploadVideoToMux(file, { churchId, mediaId: media.id, title: media.name }, callbacks);
              if (!batch.ownerActive || activeScopeRef.current.db !== batch.database || activeScopeRef.current.churchId !== batch.churchId) {
                const cleanup = async () => { await deleteChurchMuxAsset(batch.churchId, result.assetId); };
                try {
                  await cleanup();
                  entry.status = "cancelled";
                  entry.phase = "Church changed; cloud upload was cleaned up";
                  entry.progress = null;
                } catch (error) {
                  entry.retryCleanup = cleanup;
                  entry.status = "failed";
                  entry.error = error instanceof Error ? error.message : "Church changed; cloud cleanup needs attention.";
                  entry.progress = null;
                }
                return;
              }
              if (!claim.isCurrent() || batch.cancelledMediaIds.has(media.id)) {
                try {
                  await deleteChurchMuxAsset(churchId, result.assetId);
                } catch (error) {
                  const retry = async () => { await deleteChurchMuxAsset(churchId, result.assetId); };
                  claim.failCleanup(error instanceof Error ? error : new Error("Mux cleanup failed."), retry);
                  entry.retryCleanup = retry;
                  throw error;
                }
                entry.status = "cancelled";
                return;
              }
              entry.phase = "Updating Media";
              entry.progress = 95;
              publish();
              dispatch(updateMediaItemFields({ id: media.id, patch: buildLocalVideoCloudSharePatch(media, result, churchId) }));
              entry.status = "complete";
              entry.progress = 100;
              entry.phase = "Upload complete";
            } else {
              throw new Error("This item is not a local image or video.");
            }
          } catch (error) {
            const cleanup = error && typeof error === "object" ? error as { cleanupFailed?: boolean; retryCleanup?: () => Promise<void>; assetId?: string } : undefined;
            if (cleanup?.cleanupFailed && cleanup.retryCleanup) {
              const retry = cleanup.retryCleanup;
              claim.failCleanup(error instanceof Error ? error : new Error("Provider cleanup failed."), retry);
              entry.retryCleanup = retry;
            }
            entry.status = entry.retryCleanup ? "failed" : batch.cancelled || batch.cancelledMediaIds.has(media.id) ? "cancelled" : "failed";
            entry.error = error instanceof Error ? error.message : "Could not upload this item.";
            entry.progress = null;
          } finally {
            batch.xhrs.delete(media.id);
            batch.cancelFiles.delete(media.id);
            batch.claims.delete(media.id);
            claim.release();
            setBusy([media.id], false);
            publish();
          }
        };
        const worker = async () => {
          while (!batch.cancelled) {
            const entry = targets[cursor++];
            if (!entry) return;
            await uploadOne(entry);
          }
        };
        await Promise.all(Array.from({ length: Math.min(2, targets.length) }, () => worker()));
        if (batch.cancelled) {
          batch.files.filter((file) => file.status === "queued").forEach((file) => { file.status = "cancelled"; file.progress = null; });
        }
        const failures = batch.files.filter((file) => file.status === "failed");
        const successes = batch.files.filter((file) => file.status === "complete");
        const cancelledCount = batch.files.filter((file) => file.status === "cancelled").length;
        const terminal: Transfer["status"] = batch.cancelled ? "cancelled" : failures.length || cancelledCount ? (successes.length || cancelledCount ? "partial" : "failed") : "complete";
        batch.active = false;
        batch.stopping = false;
        publish(terminal);
        if (successes.length) onStorageUsageChanged?.();
      };
      const register = (key: string, handler: () => void | Promise<void>) => {
        const unregister = actions?.registerTransferAction(id, key, handler);
        if (unregister) batch.unregister.push(unregister);
      };
      register("cancel", async () => {
        if (batch.stopping) return;
        batch.cancelled = true;
        batch.stopping = true;
        batch.files.filter((file) => file.status === "queued").forEach((file) => { file.status = "cancelled"; file.progress = null; });
        publish();
        await Promise.all([...batch.cancelFiles.values()].map((cancel) => cancel().catch(() => undefined)));
        await batch.completion;
      });
      register("retry-failed", async () => {
        if (batch.completion) await batch.completion;
        batch.completion = runBatch(true);
        await batch.completion;
      });
      register("retry-cleanup", retryCleanup);
      register("dismiss", () => {
        if (batch.active) return;
        batch.ownerActive = false;
        batches.current.delete(id);
        batch.unregister.forEach((unregister) => unregister());
        actions?.removeTransfer(id);
      });
      publish();
      batch.completion = runBatch();
      await batch.completion;
    },
    [actions, churchId, db, deviceId, dispatch, isGuestSession, onStorageUsageChanged, setBusy, showToast, uploadPreset],
  );

  const getBarAction = useCallback(
    (media: MediaType, selectedCount: number, selectedMedia?: MediaType[]): MediaLibraryBarAction | null => {
      const items = selectedMedia?.length ? selectedMedia : [media];
      if (selectedCount !== items.length) return null;
      const isUploading = items.some((item) => uploadingMediaIds.has(item.id) || isMediaUploadClaimed(item.id));
      return getLocalMediaCloudShareBarAction({
        media,
        mediaItems: items,
        deviceId,
        isGuest: isGuestSession,
        isUploading,
        onUpload: (eligible) => { void uploadOwnedLocalMedia(eligible); },
        onRequest: () => requestLocalMediaCloudUpload(media),
      });
    },
    [deviceId, isGuestSession, requestLocalMediaCloudUpload, uploadOwnedLocalMedia, uploadingMediaIds],
  );

  return { deviceId, getBarAction, uploadOwnedLocalMedia };
}
