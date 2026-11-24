import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useStore } from "react-redux";
import { CloudUpload } from "lucide-react";
import { ControllerInfoContext, globalDb } from "../../context/controllerInfo";
import { GlobalInfoContext, globalFireDbInfo } from "../../context/globalInfo";
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
import { readMediaItemForDeletion } from "../../utils/mediaDocUtils";
import { registerLinkedVideoReplacementRecovery } from "./relinkLocalVideo";
import type { RootState } from "../../store/store";
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
import { uploadLocalVideoAssetToMux, uploadVideoToMux } from "./utils/muxUpload";

/** The preload API exists on every desktop, but the streaming service ships only where its binaries do. */
export const canUploadLocalVideoAssetNatively = async (
  api = window.electronAPI,
): Promise<boolean> => {
  if (!api?.uploadLocalVideoAssetToMux || !api.isVideoDownloaderAvailable) return false;
  try {
    return await api.isVideoDownloaderAvailable();
  } catch {
    return false;
  }
};

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

const sameLocalDatabase = (left: unknown, right: unknown) => {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftName = (left as { name?: unknown }).name;
  const rightName = (right as { name?: unknown }).name;
  return typeof leftName === "string" && leftName.length > 0 && leftName === rightName;
};

export function useLocalMediaCloudShare(onStorageUsageChanged?: () => void) {
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();
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
      const transfer = actionsRef.current?.getTransfer(batch.id);
      if (transfer?.status === "active") {
        actionsRef.current?.updateTransfer({
          ...transfer,
          phase: { ...transfer.phase, key: "active", label: "Upload continues after Media closes" },
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
      if (!db || activeScopeRef.current.db !== db || activeScopeRef.current.churchId !== churchId) {
        showToast("Media Library changed. Refresh it before starting this upload.", "error");
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
      const isBatchScopeCurrent = () => {
        const activeScope = batch.ownerActive
          ? activeScopeRef.current
          : { db: globalDb, churchId: globalFireDbInfo.churchId };
        return Boolean(
          batch.database && batch.churchId &&
          sameLocalDatabase(activeScope.db, batch.database) &&
          activeScope.churchId === batch.churchId,
        );
      };
      const assertBatchScope = () => {
        if (!isBatchScopeCurrent()) {
          throw new Error("This upload belongs to another church. Return to the original church to continue.");
        }
      };
      const reportScopeMismatch = (entries: CloudShareFile[]) => {
        entries.forEach((entry) => {
          entry.status = "failed";
          entry.progress = null;
          entry.error = "Return to the original church to retry this upload.";
        });
        publish("failed");
      };
      const publish = (terminal?: Transfer["status"]) => {
        const complete = batch.files.filter((file) => file.status === "complete").length;
        const failed = batch.files.filter((file) => file.status === "failed");
        const retryableFailures = failed.filter((file) => !file.retryCleanup);
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
                ...(retryableFailures.length && !batch.cancelled ? [{ key: "retry-failed", label: "Retry failed files" }] : []),
                { key: "dismiss", label: "Dismiss" },
              ],
        };
        if (!batch.ownerActive && status === "active") {
          transfer.phase = { ...transfer.phase, key: "active", label: "Upload continues after Media closes" };
        }
        actionsRef.current?.updateTransfer(transfer);
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
        if (!isBatchScopeCurrent()) {
          reportScopeMismatch(batch.files.filter((file) => retryFailedOnly
            ? file.status === "failed" && !file.retryCleanup
            : file.status === "queued"));
          return;
        }
        batch.cancelled = false;
        batch.active = true;
        const targets = batch.files.filter((file) => retryFailedOnly ? file.status === "failed" && !file.retryCleanup : file.status === "queued");
        targets.forEach((file) => { file.status = "queued"; file.progress = 0; file.error = undefined; });
        publish();
        let cursor = 0;
        const uploadOne = async (entry: CloudShareFile) => {
          let media = entry.media;
          const claim = claimMediaUpload(media.id);
          if (!claim) {
            entry.status = "failed";
            entry.error = "This item is already being changed.";
            publish();
            return;
          }
          batch.claims.set(media.id, claim);
          if (batch.ownerActive) setBusy([media.id], true);
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
                const retry = () => retryLocalImageUploadCancellation(media.localImage!.id, batch.churchId);
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
            assertBatchScope();
            if (retryFailedOnly) {
              const latestMedia = reduxStore.getState().media.list.find((item) => item.id === media.id);
              assertBatchScope();
              if (!latestMedia) throw new Error("This video was removed from Media Library. Select an available item to upload.");
              if (!canUploadLocalMediaToCloud(latestMedia, deviceId)) {
                throw new Error("This video is no longer available for cloud upload. Refresh Media Library and select the current item.");
              }
              media = latestMedia;
              entry.media = latestMedia;
            }
            if (media.localImage) {
              const assetId = media.localImage.id;
              if (retryFailedOnly) {
                assertBatchScope();
                const job = await getLocalImageUploadJob(assetId);
                assertBatchScope();
                if (job?.status === "failed" && !job.cancelRequested) {
                  await retryLocalImageUpload(assetId);
                  assertBatchScope();
                }
              }
              if (!claim.isCurrent() || batch.cancelledMediaIds.has(media.id)) { entry.status = "cancelled"; return; }
              assertBatchScope();
              await enqueueLocalImageUpload({ assetId, itemId: "", workspaceId: batch.churchId, uploadPreset, mediaId: media.id });
              if (!claim.isCurrent() || batch.cancelledMediaIds.has(media.id)) {
                try { await cancelLocalImageUpload(assetId); }
                catch (error) {
                  const retry = () => retryLocalImageUploadCancellation(assetId, batch.churchId);
                  claim.failCleanup(error instanceof Error ? error : new Error("Image cleanup failed."), retry);
                  entry.retryCleanup = retry;
                  throw error;
                }
                entry.status = "cancelled";
                return;
              }
              if (!isBatchScopeCurrent()) {
                try { await cancelLocalImageUpload(assetId); }
                catch (error) {
                  const retry = () => retryLocalImageUploadCancellation(assetId, batch.churchId);
                  claim.failCleanup(error instanceof Error ? error : new Error("Image cleanup failed."), retry);
                  entry.retryCleanup = retry;
                  throw error;
                }
                entry.status = "failed";
                entry.error = "Church changed before this upload started. Return to the original church to retry.";
                entry.progress = null;
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
              if (media.localVideoFile.storageMode === "linked") {
                if (!batch.database) throw new Error("Media Library is not ready. Retry when this controller is connected.");
                assertBatchScope();
                const persisted = await readMediaItemForDeletion(batch.database as PouchDB.Database, media.id);
                if (!claim.isCurrent() || !isBatchScopeCurrent()) {
                  entry.status = "cancelled"; return;
                }
                const reference = persisted?.item.localVideoFile;
                const sourceNotReady = (message: string) => {
                  const error = new Error(message);
                  if (persisted?.item.pendingLinkedVideoCleanup?.length) {
                    const owner = { churchId: batch.churchId, workspaceId: batch.churchId,
                      dbAtStart: batch.database as PouchDB.Database, controllerProfileId: "", folderId: media.folderId ?? null, routePath: "/controller" };
                    registerLinkedVideoReplacementRecovery({ item: persisted.item, owner,
                      isOwnerCurrent: () => globalDb === owner.dbAtStart && globalFireDbInfo.churchId === owner.churchId,
                      getItems: () => reduxStore.getState().media.list, dispatch, transfer: actionsRef.current ?? undefined, error });
                  }
                  return error;
                };
                if (!reference || reference.id !== media.localVideoFile.id || reference.contentHash !== media.localVideoFile.contentHash) {
                  throw sourceNotReady("This video changed. Finish any pending relink in Activity, then select the video again and restart the upload.");
                }
                assertBatchScope();
                const native = await window.electronAPI?.getLocalAsset(reference.id);
                if (!native || native.workspaceId !== batch.churchId ||
                    (reference.contentHash && native.contentHash !== reference.contentHash)) {
                  throw sourceNotReady("This video's local source is not ready. Finish relinking in Activity or reconnect its drive, then retry the upload.");
                }
                if (!claim.isCurrent() || !isBatchScopeCurrent()) {
                  entry.status = "cancelled"; return;
                }
              }
              const callbacks: MuxUploadCallbacks = {
                onProgress: (value) => { entry.progress = Math.min(88, value * 0.88); entry.phase = "Uploading video"; publish(); },
                onStageUpdate: (stage, message) => {
                  entry.phase = message;
                  if (stage === "processing") entry.progress = null;
                  publish();
                },
                onStatusUpdate: (message) => { entry.phase = message; publish(); },
                isCancelled: () => batch.cancelled || batch.cancelledMediaIds.has(media.id),
                setXhr: (xhr) => batch.xhrs.set(media.id, xhr),
                setCancelUpload: (cancel) => { cancelMuxUpload = cancel; },
              };
              let result: MuxUploadResult;
              const canStreamNatively = await canUploadLocalVideoAssetNatively();
              assertBatchScope();
              if (canStreamNatively) {
                result = await uploadLocalVideoAssetToMux(
                  media.localVideoFile.id,
                  media.localVideoFile.fileName || `${media.name}.mp4`,
                  { churchId: batch.churchId, mediaId: media.id, title: media.name },
                  callbacks,
                );
              } else {
                const parts = await getLocalVideoFileBlob(media.localVideoFile.id);
                if (!parts) throw new Error("This video is not available on this device.");
                assertBatchScope();
                if (!claim.isCurrent() || batch.cancelledMediaIds.has(media.id)) { entry.status = "cancelled"; return; }
                const file = new File([parts.blob], parts.fileName, { type: parts.contentType || "video/mp4" });
                result = await uploadVideoToMux(file, { churchId: batch.churchId, mediaId: media.id, title: media.name }, callbacks);
              }
              if (!isBatchScopeCurrent()) {
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
                  await deleteChurchMuxAsset(batch.churchId, result.assetId);
                } catch (error) {
                  const retry = async () => { await deleteChurchMuxAsset(batch.churchId, result.assetId); };
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
              const currentMedia = reduxStore.getState().media.list.find((item) => item.id === media.id);
              if (!currentMedia || currentMedia.localVideoFile?.id !== media.localVideoFile.id ||
                  currentMedia.localVideoFile.contentHash !== media.localVideoFile.contentHash) {
                const sourceChanged = new Error("This video's local source changed or was removed before the cloud upload finished. Select the current item in Media Library to start a new upload.");
                try {
                  await deleteChurchMuxAsset(batch.churchId, result.assetId);
                } catch (cleanupError) {
                  const retry = async () => { await deleteChurchMuxAsset(batch.churchId, result.assetId); };
                  claim.failCleanup(cleanupError instanceof Error ? cleanupError : new Error("Mux cleanup failed."), retry);
                  entry.retryCleanup = retry;
                  throw new Error(`${sourceChanged.message} Cloud cleanup needs attention: ${cleanupError instanceof Error ? cleanupError.message : "retry cleanup"}`);
                }
                throw sourceChanged;
              }
              assertBatchScope();
              dispatch(updateMediaItemFields({ id: media.id, patch: buildLocalVideoCloudSharePatch(currentMedia, result, batch.churchId) }));
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
            if (batch.ownerActive) setBusy([media.id], false);
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
        if (successes.length && batch.ownerActive && isBatchScopeCurrent()) onStorageUsageChanged?.();
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
        if (!isBatchScopeCurrent()) {
          reportScopeMismatch(batch.files.filter((file) => file.status === "failed" && !file.retryCleanup));
          return;
        }
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
    [actions, churchId, db, deviceId, dispatch, isGuestSession, onStorageUsageChanged, reduxStore, setBusy, showToast, uploadPreset],
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
