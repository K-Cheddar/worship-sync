import {
  useState,
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useCallback,
  useContext,
} from "react";
import { Cloud, Upload } from "lucide-react";
import Button from "../../components/Button/Button";
import Modal from "../../components/Modal/Modal";
import Toggle from "../../components/Toggle/Toggle";
import { ControllerInfoContext, globalDb } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { LocalAssetStoragePolicy } from "../../types";
import {
  getRememberedLocalImagePolicy,
  rememberLocalImagePolicy,
  deleteLocalImage,
} from "../../utils/localImageAssets";
import { deleteLocalVideoFile } from "../../utils/localVideoFileAssets";
import { cancelLocalImageUpload, enqueueLocalImageUpload, getLocalImageUploadJob, retryLocalImageUpload, retryLocalImageUploadCancellation, waitForLocalImageUpload } from "../../utils/localImageUploadQueue";
import { claimMediaUpload, type MediaUploadClaim } from "../../utils/mediaOperationClaims";
import { deleteChurchMuxAsset } from "../../api/providerStorage";
import { createLocalMediaFromFile } from "./localMediaImport";
import { buildLocalVideoCloudSharePatch } from "./localMediaCloudShare";
import {
  MediaUploadInputProps,
  MediaUploadInputRef,
  FileUploadProgress,
  UploadStatus,
} from "./MediaUploadInput.types";
import { detectFileType, validateFiles } from "./utils/fileUtils";
import {
  convertMuxVideoToLocalMp4,
  uploadVideoToMux,
  type MuxUploadCallbacks,
} from "./utils/muxUpload";
import { convertCloudinaryImageToLocalWebp } from "./utils/cloudinaryUpload";
import { FileList } from "./components/FileList";
import { useNativeFileDrop } from "./useNativeFileDrop";
import { normalizeMediaLibraryDisplayName } from "./mediaLibraryMeta";
import { useOptionalTransferActions, useOptionalTransfers } from "../../context/transferContext";
import { getMediaTransferOverview, type Transfer } from "../../context/transferModel";
import { getMediaBatchProgress, getMediaCloudFileProgress } from "./mediaUploadProgress";

const isLocalMediaPlaybackError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "LocalVideoPlaybackError" ||
    error.name === "LocalImagePlaybackError");

const deleteLocalMediaAsset = async (media: FileUploadProgress["localMedia"]) => {
  if (media?.localImage) await deleteLocalImage(media.localImage.id);
  else if (media?.localVideoFile) await deleteLocalVideoFile(media.localVideoFile.id);
};

const registerLocalAssetCleanupRetry = (
  media: NonNullable<FileUploadProgress["localMedia"]>,
  retryCleanup: () => Promise<void>,
  initialError: unknown,
  updateTransfer?: (transfer: Transfer) => void,
  registerTransferAction?: (id: string, key: string, handler: () => void | Promise<void>) => () => void,
  removeTransfer?: (id: string) => void,
) => {
  if (!updateTransfer || !registerTransferAction) return false;
  const transferId = `media-cleanup-${media.id}`;
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Local asset cleanup failed. Try again.";
  const publish = (error?: unknown) => updateTransfer({
    id: transferId,
    type: "Media upload",
    name: media.name,
    status: "cancelled",
    progress: 0,
    phase: { key: "cancelled", label: "Upload cancelled" },
    detail: "The local asset still needs cleanup.",
    files: [{ id: media.id, name: media.name, status: "cancelled", progress: 0, phase: "Upload cancelled" }],
    ...(error ? { error: { message: errorMessage(error) } } : {}),
    canCancel: false,
    blocksUnload: false,
    actions: [{ key: "retry-cleanup", label: "Retry cleanup" }, { key: "dismiss", label: "Dismiss" }],
  });
  let unregisterRetry = () => {};
  let unregisterDismiss = () => {};
  unregisterRetry = registerTransferAction(transferId, "retry-cleanup", async () => {
    try {
      await retryCleanup();
      unregisterRetry();
      unregisterDismiss();
      removeTransfer?.(transferId);
    } catch (error) {
      publish(error);
    }
  });
  unregisterDismiss = registerTransferAction(transferId, "dismiss", () => {
    unregisterRetry();
    unregisterDismiss();
    removeTransfer?.(transferId);
  });
  publish(initialError);
  return true;
};

const MediaUploadTaskbarProgress = () => {
  const transferContext = useOptionalTransfers();
  const overview = getMediaTransferOverview(transferContext?.transfers ?? []);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const active = overview.activeCount > 0;
    api.setUploadInProgress(active);
    if (api.setTaskbarUploadProgress) {
      void api.setTaskbarUploadProgress(active && overview.progress !== null ? overview.progress / 100 : null);
    }
  }, [overview.activeCount, overview.progress]);
  useEffect(() => () => {
    const api = window.electronAPI;
    api?.setUploadInProgress(false);
    if (api?.setTaskbarUploadProgress) void api.setTaskbarUploadProgress(null);
  }, []);
  return null;
};

type UploadTimeout = {
  timeoutId: NodeJS.Timeout;
  cancel: () => void;
};

type MediaUploadBatch = {
  id: string;
  database: unknown;
  churchId: string;
  files: FileUploadProgress[];
  storagePolicy: LocalAssetStoragePolicy;
  cancelled: boolean;
  stopping?: boolean;
  xhr: XMLHttpRequest | null;
  timeouts: UploadTimeout[];
  currentFileIndex: number;
  active: boolean;
  ownerActive: boolean;
  statusMessage: string;
  unregisterActions: Array<() => void>;
  registeredActions: Map<string, () => void>;
  cancelledMediaIds: Set<string>;
  activeMediaId?: string;
  cancelActive?: () => Promise<void>;
  cleanupRetries: Map<number, () => Promise<void>>;
  completion?: Promise<void>;
};

const MediaUploadInput = forwardRef<MediaUploadInputRef, MediaUploadInputProps>(
  (
    {
      onLocalMediaAdded,
      onLocalMediaPatched,
      showButton = true,
      uploadPreset = "bpqu4ma5",
      onUploadComplete,
      uploadDisabled = false,
    },
    ref,
  ) => {
    const { churchId = "", uploadPreset: contextUploadPreset } =
      useContext(GlobalInfoContext) || {};
    const { db, isGuestSession = false } = useContext(ControllerInfoContext) || {};
    const transferContext = useOptionalTransferActions();
    const updateTransfer = transferContext?.updateTransfer;
    const removeTransfer = transferContext?.removeTransfer;
    const registerTransferAction = transferContext?.registerTransferAction;
    const resolvedUploadPreset = contextUploadPreset || uploadPreset;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [error, setError] = useState("");
    const [selectedFiles, setSelectedFiles] = useState<FileUploadProgress[]>([]);
    const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
    const [convertingFileIndex, setConvertingFileIndex] = useState<number | null>(
      null,
    );
    const [uploadToCloud, setUploadToCloud] = useState(
      () =>
        !isGuestSession &&
        getRememberedLocalImagePolicy() !== "local-only",
    );
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cancelRequestedRef = useRef(false);
    const activeXhrRef = useRef<XMLHttpRequest | null>(null);
    const conversionTimeoutsRef = useRef<UploadTimeout[]>([]);
    const legacyConversionOwnerActiveRef = useRef(true);
    const currentMediaOwnerRef = useRef({ db, churchId });
    currentMediaOwnerRef.current = { db, churchId };
    const isMediaOwnerCurrent = (database: unknown, ownerChurchId: string) =>
      database === currentMediaOwnerRef.current.db &&
      (globalDb === undefined || database === globalDb) &&
      ownerChurchId === currentMediaOwnerRef.current.churchId;
    const isBatchOwnerCurrent = (batch: MediaUploadBatch) =>
      batch.ownerActive && !batch.cancelled &&
      isMediaOwnerCurrent(batch.database, batch.churchId);
    const cancelConversionTimeouts = () => {
      const pendingTimeouts = conversionTimeoutsRef.current;
      conversionTimeoutsRef.current = [];
      pendingTimeouts.forEach(({ timeoutId, cancel }) => {
        cancel();
        clearTimeout(timeoutId);
      });
    };
    const batchesRef = useRef(new Map<string, MediaUploadBatch>());
    const cancelBatchResources = useCallback((batch: MediaUploadBatch) => {
      if (batch.xhr) {
        batch.xhr.abort();
        batch.xhr = null;
      }
      const pendingTimeouts = batch.timeouts;
      batch.timeouts = [];
      pendingTimeouts.forEach(({ timeoutId, cancel }) => {
        cancel();
        clearTimeout(timeoutId);
      });
    }, []);
    const registerBatchAction = (batch: MediaUploadBatch, key: string, handler: () => void | Promise<void>) => {
      batch.registeredActions.get(key)?.();
      const unregister = registerTransferAction?.(batch.id, key, handler);
      if (!unregister) return;
      batch.registeredActions.set(key, unregister);
      batch.unregisterActions.push(() => {
        if (batch.registeredActions.get(key) === unregister) batch.registeredActions.delete(key);
        unregister();
      });
    };
    const unregisterBatchAction = (batch: MediaUploadBatch, key: string) => {
      batch.registeredActions.get(key)?.();
      batch.registeredActions.delete(key);
    };

    const addFiles = useCallback((files: File[]) => {
      if (uploadDisabled) return;
      if (files.length === 0) return;

      const { valid, invalid } = validateFiles(files);
      if (invalid.length > 0) {
        setError(`Please select image or video files. ${invalid.length} invalid ${invalid.length === 1 ? 'file' : 'files'} found.`);
        return;
      }

      const newFiles: FileUploadProgress[] = valid.map((file) => ({
        file,
        displayName: file.name,
        fileType: detectFileType(file),
        status: "idle" as UploadStatus,
        progress: 0,
      }));

      setSelectedFiles((prev) => [...prev, ...newFiles]);
      setError("");
    }, [uploadDisabled]);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(Array.from(event.target.files || []));
    };

    const handleRemoveFile = (index: number) => {
      setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const updateFileStatus = (
      fileIndex: number,
      updates: Partial<FileUploadProgress>
    ) => {
      setSelectedFiles((prev) =>
        prev.map((item, idx) =>
          idx === fileIndex ? { ...item, ...updates } : item
        )
      );
    };

    const updateFileDisplayName = (fileIndex: number, displayName: string) => {
      updateFileStatus(fileIndex, { displayName });
    };

    const publishBatch = useCallback((batch: MediaUploadBatch, terminal?: "complete" | "partial" | "failed" | "cancelled", allowRetiredOwner = false) => {
      const progress = getMediaBatchProgress(batch.files);
      const failedFiles = batch.files.filter((file) => file.status === "error" && !batch.cancelled);
      const succeeded = batch.files.filter((file) => file.status === "ready").length;
      const status: Transfer["status"] = terminal ?? "active";
      const errorMessage = failedFiles.length
        ? `${failedFiles.length} ${failedFiles.length === 1 ? "file" : "files"} failed to upload.`
        : undefined;
      const transfer: Transfer = {
        id: batch.id,
        type: "Media upload",
        name: batch.files.length === 1 ? batch.files[0].displayName : `${batch.files.length} media files`,
        status,
        progress,
        phase: {
          key: status,
          label: status === "complete" ? "Upload complete" : status === "partial" ? "Upload completed with errors" : status === "failed" ? "Upload failed" : status === "cancelled" ? "Upload cancelled" : batch.statusMessage || (batch.storagePolicy === "local-and-cloud" ? "Uploading media" : "Adding media"),
          current: Math.min(batch.currentFileIndex + 1, batch.files.length),
          total: batch.files.length,
        },
        detail: `${succeeded} of ${batch.files.length} files added${failedFiles.length ? ` · ${failedFiles.length} failed` : ""}`,
        files: batch.files.map((file) => {
          const mediaId = file.localMedia?.id || "";
          return {
            id: mediaId || file.file.name,
            name: file.displayName,
            status: file.status === "ready" ? "complete" as const
              : batch.cancelled || batch.cancelledMediaIds.has(mediaId) ? "cancelled" as const
                : file.status === "error" ? "failed" as const
                  : file.status === "idle" ? "queued" as const : "active" as const,
            progress: file.progress,
            phase: batch.cancelled ? "Upload cancelled" : file.phase || (file.status === "ready" ? "Upload complete" : file.status === "error" ? "Upload failed" : "Adding media"),
            ...(!batch.cancelled && file.error ? { error: file.error } : {}),
          };
        }),
        ...(errorMessage ? { error: { message: errorMessage } } : {}),
        canCancel: status === "active" && !batch.stopping,
        blocksUnload: status === "active",
        actions: status === "active"
          ? [{ key: "cancel", label: batch.stopping ? "Cancelling…" : "Cancel upload", ...(batch.stopping ? { pending: true } : {}) }]
          : status === "partial" || status === "failed"
            ? [
                { key: "retry-failed", label: "Retry failed files" },
                ...failedFiles.filter((file) => file.canConvertForOfflinePlayback).map((file) => {
                  const index = batch.files.indexOf(file);
                  return { key: `convert-offline-${index}`, label: `Convert ${file.file.name}` };
                }),
                ...(batch.cleanupRetries.size ? [{ key: "retry-cleanup", label: "Retry cleanup" }] : []),
                { key: "dismiss", label: "Dismiss" },
              ]
            : [
                ...(batch.cleanupRetries.size ? [{ key: "retry-cleanup", label: "Retry cleanup" }] : []),
                { key: "dismiss", label: "Dismiss" },
              ],
      };
      if (batch.ownerActive || allowRetiredOwner) updateTransfer?.(transfer);
      return transfer;
    }, [updateTransfer]);

    const updateBatchFile = (batch: MediaUploadBatch, index: number, updates: Partial<FileUploadProgress>) => {
      batch.files[index] = { ...batch.files[index], ...updates };
      publishBatch(batch);
    };

    const uploadSingleFile = async (batch: MediaUploadBatch, fileIndex: number, retryFailedOnly = false): Promise<void> => {
      const { files, storagePolicy } = batch;
      const fileProgress = files[fileIndex];
      const totalFiles = files.length;
      updateBatchFile(batch, fileIndex, { status: "uploading", phase: fileProgress.localMedia ? "Starting cloud upload" : "Adding to this device", progress: fileProgress.localMedia ? 40 : 0, error: undefined });
      batch.statusMessage = `Adding ${fileIndex + 1}/${totalFiles}: ${fileProgress.displayName}...`;
      publishBatch(batch);
      let operationClaim: MediaUploadClaim | null = null;
      let claimedMediaId = "";
      try {
        const createdLocalMedia = !fileProgress.localMedia;
        const media = fileProgress.localMedia ?? (await createLocalMediaFromFile(fileProgress.file, churchId, storagePolicy, {
          allowCloudPlaybackFallback: storagePolicy === "local-and-cloud",
          ...(fileProgress.displayName !== fileProgress.file.name ? { displayName: fileProgress.displayName } : {}),
        }));
        if (!isBatchOwnerCurrent(batch)) {
          batch.cancelled = true;
          if (createdLocalMedia) {
            const retryCleanup = () => deleteLocalMediaAsset(media);
            try {
              await retryCleanup();
            } catch (error) {
              batch.cleanupRetries.set(fileIndex, retryCleanup);
              throw error;
            }
          }
          updateBatchFile(batch, fileIndex, { status: "error", error: "Cancelled", phase: "Upload cancelled" });
          return;
        }
        if (createdLocalMedia) {
          onLocalMediaAdded(media);
          updateBatchFile(batch, fileIndex, { localMedia: media, progress: 40, phase: "Saved on this device" });
        }
        if (storagePolicy !== "local-and-cloud") {
          updateBatchFile(batch, fileIndex, { status: "ready", progress: 100, phase: "Added to Media" });
          return;
        }
        if (batch.cancelled) {
          updateBatchFile(batch, fileIndex, { status: "error", error: "Cancelled" });
          return;
        }
        claimedMediaId = media.id;
        operationClaim = claimMediaUpload(media.id);
        if (!operationClaim) throw new Error("This media is already being changed.");
        const assetId = media.localImage?.id || media.id;
        batch.activeMediaId = media.id;
        let cancelMuxUpload: (() => Promise<void>) | undefined;
        const cancelOne = async () => {
          batch.cancelledMediaIds.add(media.id);
          if (batch.activeMediaId === media.id) {
            batch.xhr?.abort();
            batch.xhr = null;
          }
          if (fileProgress.fileType === "video" && cancelMuxUpload) {
            try { await cancelMuxUpload(); }
            catch (error) {
              const failure = error && typeof error === "object" ? error as { retryCleanup?: () => Promise<void> } : undefined;
              const retry = failure?.retryCleanup || cancelMuxUpload;
              operationClaim?.failCleanup(error instanceof Error ? error : new Error("Mux cleanup failed."), retry);
              batch.cleanupRetries.set(fileIndex, retry);
              throw error;
            }
          }
          if (fileProgress.fileType === "image") {
            try { await cancelLocalImageUpload(assetId); }
            catch (error) {
              const retry = () => retryLocalImageUploadCancellation(assetId, churchId);
              operationClaim?.failCleanup(error instanceof Error ? error : new Error("Image cleanup failed."), retry);
              batch.cleanupRetries.set(fileIndex, retry);
              throw error;
            }
          }
        };
        batch.cancelActive = cancelOne;
        operationClaim.setCancel(cancelOne);

        const callbacks: MuxUploadCallbacks = {
          onProgress: (cloudProgress) => {
            if (!isBatchOwnerCurrent(batch)) return;
            const fileProgressValue = getMediaCloudFileProgress(cloudProgress);
            batch.statusMessage = `Uploading ${fileIndex + 1}/${totalFiles}: ${fileProgress.displayName}... ${Math.round(cloudProgress)}%`;
            updateBatchFile(batch, fileIndex, { progress: fileProgressValue, phase: "Uploading to cloud" });
          },
          onStatusUpdate: (message) => {
            if (!isBatchOwnerCurrent(batch)) return;
            batch.statusMessage = message;
            updateBatchFile(batch, fileIndex, { phase: message });
          },
          isCancelled: () => !isBatchOwnerCurrent(batch) || batch.cancelledMediaIds.has(media.id),
          setXhr: (xhr) => { batch.xhr = xhr; },
          setCancelUpload: (cancel) => { cancelMuxUpload = cancel; },
          addTimeout: (timeoutId, cancel) => { batch.timeouts.push({ timeoutId, cancel }); },
        };

        if (fileProgress.fileType === "video") {
          updateBatchFile(batch, fileIndex, { status: "processing", progress: 40, phase: "Uploading video" });
          const result = await uploadVideoToMux(fileProgress.file, { churchId, mediaId: media.id, title: fileProgress.displayName }, callbacks);
          if (!isBatchOwnerCurrent(batch)) {
            batch.cancelled = true;
            const cleanup = async () => { await deleteChurchMuxAsset(churchId, result.assetId); };
            try {
              await cleanup();
            } catch (error) {
              operationClaim.failCleanup(error instanceof Error ? error : new Error("Mux cleanup failed."), cleanup);
              batch.cleanupRetries.set(fileIndex, cleanup);
            }
            throw new Error("Church changed while this upload was running. The video was not added to the current Media library.");
          }
          if (!operationClaim.isCurrent() || !isBatchOwnerCurrent(batch) || batch.cancelledMediaIds.has(media.id)) {
            if (!isBatchOwnerCurrent(batch)) batch.cancelled = true;
            try { await deleteChurchMuxAsset(churchId, result.assetId); }
            catch (error) {
              const retry = async () => { await deleteChurchMuxAsset(churchId, result.assetId); };
              operationClaim.failCleanup(error instanceof Error ? error : new Error("Mux cleanup failed."), retry);
              batch.cleanupRetries.set(fileIndex, retry);
              throw error;
            }
            throw new Error("Upload cancelled because this media is being deleted.");
          }
          updateBatchFile(batch, fileIndex, { progress: 95, phase: "Updating Media" });
          onLocalMediaPatched?.(media.id, buildLocalVideoCloudSharePatch(media, result, churchId));
        } else {
          if (!churchId) throw new Error("Could not start the cloud upload. Try again.");
          const currentJob = await getLocalImageUploadJob(assetId);
          if (!operationClaim.isCurrent() || !isBatchOwnerCurrent(batch) || batch.cancelledMediaIds.has(media.id)) throw new Error("Upload cancelled because this media is being deleted.");
          if (retryFailedOnly && currentJob?.status === "failed" && !currentJob.cancelRequested) {
            await retryLocalImageUpload(assetId);
          }
          await enqueueLocalImageUpload({ assetId, itemId: "", workspaceId: churchId, uploadPreset: resolvedUploadPreset, mediaId: media.id });
          if (!operationClaim.isCurrent() || !isBatchOwnerCurrent(batch) || batch.cancelledMediaIds.has(media.id)) {
            if (!isBatchOwnerCurrent(batch)) batch.cancelled = true;
            try { await cancelLocalImageUpload(assetId); }
            catch (error) {
              const retry = () => retryLocalImageUploadCancellation(assetId, churchId);
              operationClaim.failCleanup(error instanceof Error ? error : new Error("Image cleanup failed."), retry);
              batch.cleanupRetries.set(fileIndex, retry);
              throw error;
            }
            throw new Error("Upload cancelled because this media is being deleted.");
          }
          await waitForLocalImageUpload(assetId, (state) => {
            if (!isBatchOwnerCurrent(batch)) return;
            updateBatchFile(batch, fileIndex, {
              status: state.status === "complete" ? "ready" : state.status === "failed" || state.status === "cancelled" ? "error" : state.status === "queued" ? "uploading" : "processing",
              progress: state.progress === null ? fileProgress.progress : 40 + (state.progress || 0) * 0.6,
              phase: state.phase,
              ...(state.error ? { error: state.error } : {}),
            });
          });
          if (!isBatchOwnerCurrent(batch)) {
            batch.cancelled = true;
            try { await cancelLocalImageUpload(assetId); }
            catch (error) {
              const retry = () => retryLocalImageUploadCancellation(assetId, churchId);
              operationClaim.failCleanup(error instanceof Error ? error : new Error("Image cleanup failed."), retry);
              batch.cleanupRetries.set(fileIndex, retry);
            }
            updateBatchFile(batch, fileIndex, { status: "error", error: "Cancelled", phase: "Upload cancelled" });
            return;
          }
        }
        updateBatchFile(batch, fileIndex, { status: "ready", progress: 100, phase: "Upload complete" });
      } catch (err) {
        const cleanup = err && typeof err === "object" ? err as { cleanupFailed?: boolean; retryCleanup?: () => Promise<void> } : undefined;
        if (cleanup?.cleanupFailed && cleanup.retryCleanup) {
          operationClaim?.failCleanup(err instanceof Error ? err : new Error("Provider cleanup failed."), cleanup.retryCleanup);
          batch.cleanupRetries.set(fileIndex, cleanup.retryCleanup);
        }
        const wasDeleted = batch.cancelledMediaIds.has(claimedMediaId);
        const canConvertForOfflinePlayback = !batch.cancelled && !wasDeleted && isLocalMediaPlaybackError(err);
        updateBatchFile(batch, fileIndex, {
          status: "error",
          error: batch.cancelled || wasDeleted ? "Cancelled" : err instanceof Error ? err.message : "Upload failed",
          canConvertForOfflinePlayback,
          phase: wasDeleted ? "Stopped for deletion" : "Upload failed",
        });
        if (canConvertForOfflinePlayback) {
          registerBatchAction(batch, `convert-offline-${fileIndex}`, () => convertBatchFileForOfflinePlayback(batch, fileIndex));
        }
        if (!batch.cancelled && !wasDeleted) throw err;
      } finally {
        if (batch.activeMediaId === claimedMediaId) {
          batch.activeMediaId = undefined;
          batch.cancelActive = undefined;
        }
        operationClaim?.release();
      }
    };

    const convertBatchFileForOfflinePlayback = async (batch: MediaUploadBatch, fileIndex: number) => {
      const fileProgress = batch.files[fileIndex];
      if (!fileProgress?.canConvertForOfflinePlayback || batch.active) return;
      batch.cancelled = false;
      batch.active = true;
      batch.currentFileIndex = fileIndex;
      batch.statusMessage = `Converting ${fileProgress.file.name} for offline playback...`;
      updateBatchFile(batch, fileIndex, { status: "processing", progress: 0, error: undefined });

      const callbacks: MuxUploadCallbacks = {
        onProgress: (progress) => {
          if (!isBatchOwnerCurrent(batch)) return;
          batch.statusMessage = `Converting ${fileProgress.file.name} for offline playback... ${Math.round(progress)}%`;
          updateBatchFile(batch, fileIndex, { progress });
        },
        onStatusUpdate: (message) => {
          if (!isBatchOwnerCurrent(batch)) return;
          batch.statusMessage = message;
          publishBatch(batch);
        },
        isCancelled: () => !isBatchOwnerCurrent(batch),
        setXhr: (xhr) => { batch.xhr = xhr; },
        addTimeout: (timeoutId, cancel) => { batch.timeouts.push({ timeoutId, cancel }); },
      };
      let imageClaim: MediaUploadClaim | null = null;
      try {
        let media = fileProgress.localMedia;
        if (!media) {
          const convertedFile = fileProgress.fileType === "image"
            ? await convertCloudinaryImageToLocalWebp(fileProgress.file, resolvedUploadPreset, callbacks, churchId)
            : await convertMuxVideoToLocalMp4(fileProgress.file, churchId, callbacks);
          if (!isBatchOwnerCurrent(batch)) {
            batch.cancelled = true;
            batch.active = false;
            publishBatch(batch, "cancelled", true);
            return;
          }
          media = await createLocalMediaFromFile(convertedFile, churchId, "local-only", {
            importBytes: true,
            ...(fileProgress.displayName !== fileProgress.file.name ? { displayName: fileProgress.displayName } : {}),
          });
          if (!isBatchOwnerCurrent(batch)) {
            batch.cancelled = true;
            const retryCleanup = () => deleteLocalMediaAsset(media);
            try {
              await retryCleanup();
            } catch (error) {
              batch.cleanupRetries.set(fileIndex, retryCleanup);
              throw error;
            }
            updateBatchFile(batch, fileIndex, { status: "error", error: "Cancelled" });
            batch.active = false;
            publishBatch(batch, "cancelled", true);
            return;
          }
          onLocalMediaAdded(media);
          updateBatchFile(batch, fileIndex, { localMedia: media });
        }
        if (!isBatchOwnerCurrent(batch)) {
          batch.cancelled = true;
          batch.active = false;
          publishBatch(batch, "cancelled", true);
          return;
        }
        if (fileProgress.fileType === "image" && batch.storagePolicy === "local-and-cloud" && churchId) {
          const mediaId = media.id;
          const assetId = media.localImage?.id || media.id;
          imageClaim = claimMediaUpload(mediaId);
          if (!imageClaim) throw new Error("This media is already being changed.");
          const claim = imageClaim;
          const cancelImage = async () => {
            batch.cancelledMediaIds.add(mediaId);
            try { await cancelLocalImageUpload(assetId); }
            catch (error) {
              const retry = () => retryLocalImageUploadCancellation(assetId, churchId);
              claim.failCleanup(error instanceof Error ? error : new Error("Image cleanup failed."), retry);
              batch.cleanupRetries.set(fileIndex, retry);
              throw error;
            }
          };
          batch.activeMediaId = mediaId;
          batch.cancelActive = cancelImage;
          claim.setCancel(cancelImage);
          if (!claim.isCurrent() || !isBatchOwnerCurrent(batch)) throw new Error("Upload cancelled.");
          await enqueueLocalImageUpload({ assetId, itemId: "", workspaceId: churchId, uploadPreset: resolvedUploadPreset, mediaId });
          await waitForLocalImageUpload(assetId, (state) => {
            if (!isBatchOwnerCurrent(batch)) return;
            updateBatchFile(batch, fileIndex, {
              status: state.status === "complete" ? "ready" : state.status === "failed" || state.status === "cancelled" ? "error" : state.status === "queued" ? "uploading" : "processing",
              progress: state.progress ?? undefined,
              phase: state.phase,
              ...(state.error ? { error: state.error } : {}),
            });
          });
          if (!claim.isCurrent() || !isBatchOwnerCurrent(batch) || batch.cancelledMediaIds.has(mediaId)) {
            if (!isBatchOwnerCurrent(batch)) {
              batch.cancelled = true;
              try { await cancelLocalImageUpload(assetId); }
              catch (error) {
                const retry = () => retryLocalImageUploadCancellation(assetId, churchId);
                claim.failCleanup(error instanceof Error ? error : new Error("Image cleanup failed."), retry);
                batch.cleanupRetries.set(fileIndex, retry);
              }
            }
            throw new Error("Upload cancelled.");
          }
        }
        updateBatchFile(batch, fileIndex, { status: "ready", progress: 100, phase: "Upload complete", canConvertForOfflinePlayback: false });
        batch.active = false;
        const failedCount = batch.files.filter((file) => file.status === "error").length;
        publishBatch(batch, failedCount ? (batch.files.some((file) => file.status === "ready") ? "partial" : "failed") : "complete");
      } catch (conversionError) {
        updateBatchFile(batch, fileIndex, {
          status: "error",
          error: batch.cancelled || !isBatchOwnerCurrent(batch)
            ? "Cancelled"
            : conversionError instanceof Error ? conversionError.message : "Conversion failed",
          canConvertForOfflinePlayback: isBatchOwnerCurrent(batch),
        });
        batch.active = false;
        publishBatch(
          batch,
          batch.cancelled || !isBatchOwnerCurrent(batch)
            ? "cancelled"
            : batch.files.some((file) => file.status === "ready") ? "partial" : "failed",
          !isBatchOwnerCurrent(batch),
        );
      } finally {
        if (imageClaim) {
          if (batch.activeMediaId === batch.files[fileIndex]?.localMedia?.id) {
            batch.activeMediaId = undefined;
            batch.cancelActive = undefined;
          }
          imageClaim.release();
        }
        cancelBatchResources(batch);
      }
    };

    const convertFileForOfflinePlayback = async (fileIndex: number) => {
      const fileProgress = selectedFiles[fileIndex];
      if (
        !fileProgress?.canConvertForOfflinePlayback ||
        convertingFileIndex !== null ||
        uploadStatus === "uploading" ||
        uploadStatus === "processing"
      ) {
        return;
      }

      setConvertingFileIndex(fileIndex);
      setUploadStatus("processing");
      setError("");
      cancelRequestedRef.current = false;
      const ownerAtStart = { db, churchId };
      const isOwnerCurrent = () =>
        legacyConversionOwnerActiveRef.current &&
        !cancelRequestedRef.current &&
        isMediaOwnerCurrent(ownerAtStart.db, ownerAtStart.churchId);

      const callbacks: MuxUploadCallbacks = {
        onProgress: (progress) => {
          if (!isOwnerCurrent()) return;
          updateFileStatus(fileIndex, { progress });
        },
        isCancelled: () => !isOwnerCurrent(),
        setXhr: (xhr) => {
          activeXhrRef.current = xhr;
        },
        addTimeout: (timeoutId, cancel) => {
          conversionTimeoutsRef.current.push({ timeoutId, cancel });
        },
      };

      updateFileStatus(fileIndex, {
        status: "processing",
        progress: 0,
        error: undefined,
      });
      try {
        let media = fileProgress.localMedia;
        if (!media) {
          const convertedFile =
            fileProgress.fileType === "image"
              ? await convertCloudinaryImageToLocalWebp(
                  fileProgress.file,
                  resolvedUploadPreset,
                  callbacks,
                  churchId,
                )
              : await convertMuxVideoToLocalMp4(
                  fileProgress.file,
                  churchId,
                  callbacks,
                );
          if (!isOwnerCurrent()) {
            if (legacyConversionOwnerActiveRef.current && !cancelRequestedRef.current) setUploadStatus("idle");
            return;
          }
          media = await createLocalMediaFromFile(
            convertedFile,
            churchId,
            "local-only",
            {
              importBytes: true,
              ...(fileProgress.displayName !== fileProgress.file.name
                ? { displayName: fileProgress.displayName }
                : {}),
            },
          );
          if (!isOwnerCurrent()) {
            if (legacyConversionOwnerActiveRef.current && !cancelRequestedRef.current) setUploadStatus("idle");
            const retryCleanup = () => deleteLocalMediaAsset(media);
            try {
              await retryCleanup();
            } catch (cleanupError) {
              const retryRegistered = registerLocalAssetCleanupRetry(
                media,
                retryCleanup,
                cleanupError,
                updateTransfer,
                registerTransferAction,
                removeTransfer,
              );
              if (!retryRegistered && legacyConversionOwnerActiveRef.current) {
                setError(cleanupError instanceof Error ? cleanupError.message : "Local asset cleanup failed. Try again.");
              }
            }
            return;
          }
          onLocalMediaAdded(media);
          // Local conversion/import is durable. A later cloud-share failure
          // must retry from this checkpoint instead of creating another item.
          updateFileStatus(fileIndex, { localMedia: media });
        }
        if (
          fileProgress.fileType === "image" &&
          uploadToCloud &&
          !isGuestSession &&
          churchId
        ) {
          await enqueueLocalImageUpload({
            assetId: media.localImage?.id || media.id,
            itemId: "",
            workspaceId: churchId,
            uploadPreset: resolvedUploadPreset,
          });
          if (!isOwnerCurrent()) {
            await cancelLocalImageUpload(media.localImage?.id || media.id).catch(() => undefined);
            return;
          }
        }
        updateFileStatus(fileIndex, {
          status: "ready",
          progress: 100,
          canConvertForOfflinePlayback: false,
        });
        setUploadStatus("ready");
        window.setTimeout(() => handleCancel(), 2000);
      } catch (err) {
        if (!legacyConversionOwnerActiveRef.current) return;
        updateFileStatus(fileIndex, {
          status: "error",
          error: err instanceof Error ? err.message : "Conversion failed",
          canConvertForOfflinePlayback: true,
        });
        setUploadStatus("error");
        setError(
          err instanceof Error
            ? err.message
            : "Could not convert this video for offline playback.",
        );
      } finally {
        if (legacyConversionOwnerActiveRef.current) {
          setConvertingFileIndex(null);
          activeXhrRef.current = null;
        }
        cancelConversionTimeouts();
      }
    };

    const runMediaBatch = async (batch: MediaUploadBatch, retryFailedOnly = false) => {
      batch.cancelled = false;
      batch.stopping = false;
      batch.active = true;
      batch.statusMessage = retryFailedOnly ? "Retrying failed files..." : batch.storagePolicy === "local-and-cloud" ? "Starting uploads..." : "Adding files...";
      publishBatch(batch);
      for (let index = 0; index < batch.files.length; index += 1) {
        const file = batch.files[index];
        if (!isBatchOwnerCurrent(batch)) batch.cancelled = true;
        if (batch.cancelled) break;
        if (file.status === "ready" || (retryFailedOnly && (file.status !== "error" || batch.cancelledMediaIds.has(file.localMedia?.id || "")))) continue;
        batch.currentFileIndex = index;
        try {
          await uploadSingleFile(batch, index, retryFailedOnly);
        } catch {
          // Keep processing the remaining rows; the terminal transfer lists each failure.
        }
      }

      cancelBatchResources(batch);
      if (!isBatchOwnerCurrent(batch)) batch.cancelled = true;
      if (batch.cancelled) {
        batch.active = false;
        batch.stopping = false;
        unregisterBatchAction(batch, "cancel");
        unregisterBatchAction(batch, "retry-failed");
        publishBatch(batch, "cancelled");
        return;
      }

      const failedCount = batch.files.filter((file) => file.status === "error").length;
      const succeededCount = batch.files.filter((file) => file.status === "ready").length;
      if (isBatchOwnerCurrent(batch) && batch.storagePolicy === "local-and-cloud" && succeededCount > 0) onUploadComplete?.();
      if (failedCount === 0) {
        batch.statusMessage = batch.storagePolicy === "local-and-cloud" ? "Upload complete" : "Media added";
        batch.active = false;
        batch.registeredActions.forEach((_unregister, key) => {
          if (key !== "dismiss") unregisterBatchAction(batch, key);
        });
        publishBatch(batch, "complete");
      } else {
        batch.statusMessage = `${succeededCount} succeeded, ${failedCount} failed.`;
        batch.active = false;
        unregisterBatchAction(batch, "cancel");
        publishBatch(batch, succeededCount > 0 ? "partial" : "failed");
      }
    };

    const handleUpload = () => {
      if (uploadDisabled) return;
      if (selectedFiles.length === 0) {
        setError("Please select at least one file");
        return;
      }

      const normalizedNames = selectedFiles.map((fileProgress) =>
        normalizeMediaLibraryDisplayName(fileProgress.displayName),
      );
      if (normalizedNames.some((name) => !name)) {
        setError("Each media file needs a display name.");
        return;
      }
      const storagePolicy: LocalAssetStoragePolicy =
        !isGuestSession && uploadToCloud ? "local-and-cloud" : "local-only";
      const batchId = `media-upload-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      const batch: MediaUploadBatch = {
        id: batchId,
        database: db,
        churchId,
        files: selectedFiles.map((file, index) => ({ ...file, displayName: normalizedNames[index] })),
        storagePolicy,
        cancelled: false,
        stopping: false,
        xhr: null,
        timeouts: [],
        currentFileIndex: 0,
        active: true,
        ownerActive: true,
        statusMessage: "Starting uploads...",
        unregisterActions: [],
        registeredActions: new Map(),
        cancelledMediaIds: new Set(),
        cleanupRetries: new Map(),
      };
      batchesRef.current.set(batchId, batch);
      publishBatch(batch);
      const unregisterActions = () => batch.unregisterActions.forEach((unregister) => unregister());
      if (registerTransferAction) {
        registerBatchAction(batch, "cancel", async () => {
          if (batch.stopping) return;
          batch.cancelled = true;
          batch.stopping = true;
          batch.statusMessage = "Cancelling upload...";
          cancelBatchResources(batch);
          publishBatch(batch);
          await batch.cancelActive?.().catch(() => undefined);
          await batch.completion;
        });
        registerBatchAction(batch, "retry-cleanup", async () => {
          for (const [index, retry] of batch.cleanupRetries) {
            try {
              await retry();
              batch.cleanupRetries.delete(index);
              batch.files[index].error = "Cleanup succeeded.";
            } catch (error) {
              batch.files[index].error = error instanceof Error ? error.message : "Cleanup failed. Try again.";
            }
          }
          if (isBatchOwnerCurrent(batch)) {
            publishBatch(batch, batch.files.some((file) => file.status === "ready") ? "partial" : "failed");
          } else {
            const cancelled = publishBatch(batch, "cancelled", true);
            const cleanupPending = batch.cleanupRetries.size > 0;
            updateTransfer?.({
              ...cancelled,
              ...(cleanupPending ? { error: { message: "Cloud cleanup still needs attention." } } : { error: undefined }),
              actions: [
                ...(cleanupPending ? [{ key: "retry-cleanup", label: "Retry cleanup" }] : []),
                { key: "dismiss", label: "Dismiss" },
              ],
            });
            if (!cleanupPending) unregisterBatchAction(batch, "retry-cleanup");
          }
        });
        registerBatchAction(batch, "retry-failed", async () => {
          if (!isBatchOwnerCurrent(batch)) {
            batch.cancelled = true;
            batch.active = false;
            publishBatch(batch, "cancelled", true);
            return;
          }
          if (!batch.files.some((file) => file.status === "error" && !batch.cancelledMediaIds.has(file.localMedia?.id || ""))) return;
          updateTransfer?.({ ...publishBatch(batch), actions: [{ key: "retry-failed", label: "Retrying failed files…", pending: true }, { key: "dismiss", label: "Dismiss" }] });
          if (batch.completion) await batch.completion;
          batch.completion = runMediaBatch(batch, true);
          await batch.completion;
        });
        registerBatchAction(batch, "dismiss", () => {
          cancelBatchResources(batch);
          batchesRef.current.delete(batchId);
          unregisterActions();
          removeTransfer?.(batchId);
        });
      }
      setError("");
      setUploadStatus("idle");
      setSelectedFiles([]);
      setIsModalOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      batch.completion = runMediaBatch(batch);
      void batch.completion;
    };

    const handleCancel = () => {
      if (uploadStatus === "processing") {
        cancelRequestedRef.current = true;
        if (activeXhrRef.current) {
          activeXhrRef.current.abort();
          activeXhrRef.current = null;
        }
      }

      cancelConversionTimeouts();

      setSelectedFiles([]);
      setError("");
      setUploadStatus("idle");
      setIsModalOpen(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };

    const openModal = useCallback(() => {
      if (uploadDisabled) return;
      setIsModalOpen(true);
    }, [uploadDisabled]);

    const openModalWithFiles = useCallback((files: File[]) => {
      if (uploadDisabled) return;
      openModal();
      addFiles(files);
    }, [addFiles, openModal, uploadDisabled]);

    const isUploading = uploadStatus === "uploading" || uploadStatus === "processing";
    const cloudEnabled = !isGuestSession && uploadToCloud;

    const { isFileDragOver, fileDropHandlers } = useNativeFileDrop({
      disabled: uploadDisabled || isUploading,
      onFiles: addFiles,
    });

    useImperativeHandle(
      ref,
      () => ({
        openModal,
        openModalWithFiles,
      }),
      [openModal, openModalWithFiles],
    );
    const offlineConversionCandidates = selectedFiles.reduce<number[]>(
      (candidates, fileProgress, index) => {
        if (fileProgress.canConvertForOfflinePlayback) candidates.push(index);
        return candidates;
      },
      [],
    );

    useEffect(() => {
      legacyConversionOwnerActiveRef.current = true;
      const batches = batchesRef.current;
      return () => {
      legacyConversionOwnerActiveRef.current = false;
      cancelRequestedRef.current = true;
      activeXhrRef.current?.abort();
      cancelConversionTimeouts();
      batches.forEach((batch) => {
        if (batch.active) {
          batch.cancelled = true;
          batch.active = false;
          batch.ownerActive = false;
          cancelBatchResources(batch);
          const cancelled = publishBatch(batch, "cancelled", true);
          updateTransfer?.({ ...cancelled, actions: [{ key: "dismiss", label: "Dismiss" }] });
          for (const key of [...batch.registeredActions.keys()]) {
            if (key !== "retry-cleanup" && key !== "dismiss") unregisterBatchAction(batch, key);
          }
          void (async () => {
            let cancellationError: unknown;
            try {
              await batch.cancelActive?.();
            } catch (error) {
              cancellationError = error;
            }
            try {
              await batch.completion;
            } catch {
              // The detached transfer below records cleanup work if cancellation failed.
            }
            const cleanupPending = batch.cleanupRetries.size > 0;
            if (!cleanupPending) unregisterBatchAction(batch, "retry-cleanup");
            const terminal = publishBatch(batch, "cancelled", true);
            updateTransfer?.({
              ...terminal,
              ...(cleanupPending
                ? { error: { message: cancellationError instanceof Error ? cancellationError.message : "Cloud cleanup still needs attention." } }
                : { error: undefined }),
              actions: [
                ...(cleanupPending ? [{ key: "retry-cleanup", label: "Retry cleanup" }] : []),
                { key: "dismiss", label: "Dismiss" },
              ],
            });
          })();
        } else if (batch.files.some((file) => file.status === "error")) {
          batch.ownerActive = false;
          const cleanupPending = batch.cleanupRetries.size > 0;
          for (const key of [...batch.registeredActions.keys()]) {
            if (key !== "retry-cleanup" && key !== "dismiss") unregisterBatchAction(batch, key);
          }
          if (!cleanupPending) unregisterBatchAction(batch, "retry-cleanup");
          const terminal = publishBatch(batch, batch.files.some((file) => file.status === "ready") ? "partial" : "failed", true);
          updateTransfer?.({
            ...terminal,
            actions: [
              ...(cleanupPending ? [{ key: "retry-cleanup", label: "Retry cleanup" }] : []),
              { key: "dismiss", label: "Dismiss" },
            ],
          });
        } else {
          batch.unregisterActions.forEach((unregister) => unregister());
        }
      });
      batches.clear();
      };
    }, [cancelBatchResources, publishBatch, updateTransfer]);

    useEffect(() => {
      if (isGuestSession) setUploadToCloud(false);
    }, [isGuestSession]);

    const handleUploadToCloudChange = (enabled: boolean) => {
      setUploadToCloud(enabled);
      if (!isGuestSession) {
        rememberLocalImagePolicy(enabled ? "local-and-cloud" : "local-only");
      }
    };

    const imageCount = selectedFiles.filter(f => f.fileType === "image").length;
    const videoCount = selectedFiles.filter(f => f.fileType === "video").length;
    let confirmLabel = cloudEnabled ? "Upload" : "Add";
    if (selectedFiles.length === 1) {
      confirmLabel = `${confirmLabel} (1 file)`;
    } else if (selectedFiles.length > 1) {
      confirmLabel = `${confirmLabel} (${selectedFiles.length} files)`;
    }

    return (
      <>
        <MediaUploadTaskbarProgress />
        {showButton && (
          <Button
            variant="tertiary"
            svg={Upload}
            onClick={openModal}
            title="Upload Media"
            disabled={uploadDisabled}
          >
            Add
          </Button>
        )}

        <Modal
          isOpen={isModalOpen}
          onClose={handleCancel}
          title="Upload Media"
          size="md"
          contentClassName="flex flex-col overflow-hidden"
          showCloseButton={!isUploading}
          zIndexLevel={2}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className={selectedFiles.length > 0 ? "flex min-h-0 flex-1 flex-col gap-2" : "flex shrink-0 flex-col gap-2"}>
              <label htmlFor="media-upload-input" className="shrink-0 text-sm font-semibold">
                Media Files
              </label>
              <input
                id="media-upload-input"
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.ts,.m2ts,.mts,.3gp,.3g2,.mpeg,.mpg,.ogv,.wmv,.flv"
                multiple
                onChange={handleFileSelect}
                disabled={isUploading || uploadDisabled}
                className="hidden"
              />
              <div
                {...fileDropHandlers}
                role="group"
                aria-label="Media file drop zone"
                className={[
                  "relative flex rounded border border-dashed transition-colors",
                  selectedFiles.length > 0
                    ? "flex-row flex-wrap items-center justify-between gap-2 p-2"
                    : "flex-col items-center gap-2 p-4",
                  isFileDragOver ? "border-blue-400 bg-blue-500/10" : "border-gray-600",
                ].join(" ")}
              >
                {isFileDragOver && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-blue-950/70 text-sm font-semibold text-blue-100">
                    Drop files to add media
                  </div>
                )}
                {selectedFiles.length > 0 ? (
                  <p className="text-sm text-gray-300">Drop more files here</p>
                ) : (
                  <>
                    <Upload className="size-8 text-blue-300" aria-hidden="true" />
                    <p className="text-sm text-gray-300">Drop media here or choose files</p>
                    <p className="text-xs text-gray-500">Images and videos</p>
                  </>
                )}
                <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading || uploadDisabled}>
                  {selectedFiles.length > 0 ? "Add files" : "Choose files"}
                </Button>
              </div>
              <FileList
                files={selectedFiles}
                isUploading={isUploading}
                onRemoveFile={handleRemoveFile}
                onDisplayNameChange={updateFileDisplayName}
              />
              {selectedFiles.length > 0 && (
                <div className="shrink-0 text-center text-xs text-gray-400">
                  {imageCount > 0 && videoCount > 0 && (
                    <span>
                      {imageCount} {imageCount === 1 ? 'image' : 'images'} and {videoCount} {videoCount === 1 ? 'video' : 'videos'} selected
                    </span>
                  )}
                  {imageCount > 0 && videoCount === 0 && (
                    <span>
                      {imageCount} {imageCount === 1 ? 'image' : 'images'} selected
                    </span>
                  )}
                  {imageCount === 0 && videoCount > 0 && (
                    <span>
                      {videoCount} {videoCount === 1 ? 'video' : 'videos'} selected
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-col gap-1">
              <Toggle
                label="Upload to cloud"
                icon={Cloud}
                value={cloudEnabled}
                onChange={handleUploadToCloudChange}
                disabled={isGuestSession || isUploading}
              />
              <p className="text-xs text-gray-400">
                {cloudEnabled
                  ? "Keep a copy here and upload so other computers can use it."
                  : "Keep files on this device only."}
              </p>
            </div>

            {error && <p className="shrink-0 text-sm text-red-500">{error}</p>}

            {offlineConversionCandidates.length > 0 && !isUploading && (
              <div className="flex shrink-0 flex-col gap-2 rounded border border-amber-700/60 bg-amber-950/30 p-3">
                <p className="text-sm text-amber-200">
                  Some media cannot play on this device. Convert it for offline playback?
                </p>
                <p className="text-xs text-gray-300">
                  The original is uploaded temporarily. A compatible copy is saved here, then the temporary cloud asset is removed.
                </p>
                <div className="flex flex-wrap gap-2">
                  {offlineConversionCandidates.map((fileIndex) => (
                    <Button
                      key={fileIndex}
                      variant="secondary"
                      onClick={() => {
                        void convertFileForOfflinePlayback(fileIndex);
                      }}
                      disabled={convertingFileIndex !== null}
                    >
                      Convert {selectedFiles[fileIndex].file.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-2 flex shrink-0 justify-end gap-2">
              <Button variant="secondary" onClick={handleCancel}>
                {isUploading ? "Cancel Upload" : "Cancel"}
              </Button>
              <Button
                variant="cta"
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || isUploading}
                svg={Upload}
              >
                {confirmLabel}
              </Button>
            </div>

            <div className="shrink-0 border-t border-gray-700 pt-4">
              <p className="text-xs text-gray-400">
                Select one or more images or videos.
                {cloudEnabled
                  ? " Cloud processing may take a few minutes for large videos."
                  : " You can upload to the cloud later from Media."}
              </p>
            </div>
          </div>
        </Modal>
      </>
    );
  }
);

MediaUploadInput.displayName = "MediaUploadInput";

export default MediaUploadInput;
export type { MediaUploadInputRef } from "./MediaUploadInput.types";
