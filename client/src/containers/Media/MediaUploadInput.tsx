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
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { LocalAssetStoragePolicy } from "../../types";
import {
  getRememberedLocalImagePolicy,
  rememberLocalImagePolicy,
} from "../../utils/localImageAssets";
import { enqueueLocalImageUpload } from "../../utils/localImageUploadQueue";
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
  files: FileUploadProgress[];
  storagePolicy: LocalAssetStoragePolicy;
  cancelled: boolean;
  xhr: XMLHttpRequest | null;
  timeouts: UploadTimeout[];
  currentFileIndex: number;
  active: boolean;
  statusMessage: string;
  unregisterActions: Array<() => void>;
  registeredActions: Map<string, () => void>;
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
    const { isGuestSession = false } = useContext(ControllerInfoContext) || {};
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

    const publishBatch = useCallback((batch: MediaUploadBatch, terminal?: "complete" | "partial" | "failed" | "cancelled") => {
      const progress = getMediaBatchProgress(batch.files);
      const failedFiles = batch.files.filter((file) => file.status === "error");
      const succeeded = batch.files.filter((file) => file.status === "ready").length;
      const status: Transfer["status"] = terminal ?? (batch.cancelled ? "cancelled" : "active");
      const errorMessage = failedFiles.map((file) => `${file.displayName}: ${file.error || "Upload failed."}`).join("\n");
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
        ...(errorMessage ? { error: { message: errorMessage } } : {}),
        canCancel: status === "active",
        blocksUnload: status === "active",
        actions: status === "active"
          ? [{ key: "cancel", label: "Cancel upload" }]
          : status === "partial" || status === "failed"
            ? [
                { key: "retry-failed", label: "Retry failed files" },
                ...failedFiles.filter((file) => file.canConvertForOfflinePlayback).map((file) => {
                  const index = batch.files.indexOf(file);
                  return { key: `convert-offline-${index}`, label: `Convert ${file.file.name}` };
                }),
                { key: "dismiss", label: "Dismiss" },
              ]
            : [{ key: "dismiss", label: "Dismiss" }],
      };
      updateTransfer?.(transfer);
      return transfer;
    }, [updateTransfer]);

    const updateBatchFile = (batch: MediaUploadBatch, index: number, updates: Partial<FileUploadProgress>) => {
      batch.files[index] = { ...batch.files[index], ...updates };
      publishBatch(batch);
    };

    const uploadSingleFile = async (batch: MediaUploadBatch, fileIndex: number): Promise<void> => {
      const { files, storagePolicy } = batch;
      const fileProgress = files[fileIndex];
      const totalFiles = files.length;
      updateBatchFile(batch, fileIndex, { status: "uploading", progress: fileProgress.localMedia ? 40 : 0, error: undefined });
      batch.statusMessage = `Adding ${fileIndex + 1}/${totalFiles}: ${fileProgress.file.name}...`;
      publishBatch(batch);

      try {
        const media = fileProgress.localMedia ?? (await createLocalMediaFromFile(fileProgress.file, churchId, storagePolicy, {
          allowCloudPlaybackFallback: storagePolicy === "local-and-cloud",
          ...(fileProgress.displayName !== fileProgress.file.name ? { displayName: fileProgress.displayName } : {}),
        }));
        if (!fileProgress.localMedia) {
          onLocalMediaAdded(media);
          updateBatchFile(batch, fileIndex, { localMedia: media, progress: 40 });
        }
        if (storagePolicy !== "local-and-cloud") {
          updateBatchFile(batch, fileIndex, { status: "ready", progress: 100 });
          return;
        }
        if (batch.cancelled) {
          updateBatchFile(batch, fileIndex, { status: "error", error: "Cancelled" });
          return;
        }

        const callbacks: MuxUploadCallbacks = {
          onProgress: (cloudProgress) => {
            const fileProgressValue = getMediaCloudFileProgress(cloudProgress);
            batch.statusMessage = `Uploading ${fileIndex + 1}/${totalFiles}: ${fileProgress.file.name}... ${Math.round(cloudProgress)}%`;
            updateBatchFile(batch, fileIndex, { progress: fileProgressValue });
          },
          onStatusUpdate: (message) => { batch.statusMessage = message; publishBatch(batch); },
          isCancelled: () => batch.cancelled,
          setXhr: (xhr) => { batch.xhr = xhr; },
          addTimeout: (timeoutId, cancel) => { batch.timeouts.push({ timeoutId, cancel }); },
        };

        if (fileProgress.fileType === "video") {
          updateBatchFile(batch, fileIndex, { status: "processing", progress: 40 });
          const result = await uploadVideoToMux(fileProgress.file, { churchId, mediaId: media.id, title: fileProgress.displayName }, callbacks);
          onLocalMediaPatched?.(media.id, buildLocalVideoCloudSharePatch(media, result, churchId));
        } else {
          if (!churchId) throw new Error("Could not start the cloud upload. Try again.");
          await enqueueLocalImageUpload({ assetId: media.localImage?.id || media.id, itemId: "", workspaceId: churchId, uploadPreset: resolvedUploadPreset });
        }
        updateBatchFile(batch, fileIndex, { status: "ready", progress: 100 });
      } catch (err) {
        const canConvertForOfflinePlayback = isLocalMediaPlaybackError(err);
        updateBatchFile(batch, fileIndex, {
          status: "error",
          error: batch.cancelled ? "Cancelled" : err instanceof Error ? err.message : "Upload failed",
          canConvertForOfflinePlayback,
        });
        if (canConvertForOfflinePlayback) {
          registerBatchAction(batch, `convert-offline-${fileIndex}`, () => convertBatchFileForOfflinePlayback(batch, fileIndex));
        }
        if (!batch.cancelled) throw err;
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
          batch.statusMessage = `Converting ${fileProgress.file.name} for offline playback... ${Math.round(progress)}%`;
          updateBatchFile(batch, fileIndex, { progress });
        },
        onStatusUpdate: (message) => { batch.statusMessage = message; publishBatch(batch); },
        isCancelled: () => batch.cancelled,
        setXhr: (xhr) => { batch.xhr = xhr; },
        addTimeout: (timeoutId, cancel) => { batch.timeouts.push({ timeoutId, cancel }); },
      };
      try {
        let media = fileProgress.localMedia;
        if (!media) {
          const convertedFile = fileProgress.fileType === "image"
            ? await convertCloudinaryImageToLocalWebp(fileProgress.file, resolvedUploadPreset, callbacks, churchId)
            : await convertMuxVideoToLocalMp4(fileProgress.file, churchId, callbacks);
          media = await createLocalMediaFromFile(convertedFile, churchId, "local-only", {
            importBytes: true,
            ...(fileProgress.displayName !== fileProgress.file.name ? { displayName: fileProgress.displayName } : {}),
          });
          onLocalMediaAdded(media);
          updateBatchFile(batch, fileIndex, { localMedia: media });
        }
        if (batch.cancelled) return;
        if (fileProgress.fileType === "image" && batch.storagePolicy === "local-and-cloud" && churchId) {
          await enqueueLocalImageUpload({ assetId: media.localImage?.id || media.id, itemId: "", workspaceId: churchId, uploadPreset: resolvedUploadPreset });
        }
        updateBatchFile(batch, fileIndex, { status: "ready", progress: 100, canConvertForOfflinePlayback: false });
        batch.active = false;
        const failedCount = batch.files.filter((file) => file.status === "error").length;
        publishBatch(batch, failedCount ? (batch.files.some((file) => file.status === "ready") ? "partial" : "failed") : "complete");
      } catch (conversionError) {
        updateBatchFile(batch, fileIndex, {
          status: "error",
          error: conversionError instanceof Error ? conversionError.message : "Conversion failed",
          canConvertForOfflinePlayback: true,
        });
        batch.active = false;
        publishBatch(batch, batch.files.some((file) => file.status === "ready") ? "partial" : "failed");
      } finally {
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

      const callbacks: MuxUploadCallbacks = {
        onProgress: (progress) => {
          updateFileStatus(fileIndex, { progress });
        },
        isCancelled: () => cancelRequestedRef.current,
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
        }
        updateFileStatus(fileIndex, {
          status: "ready",
          progress: 100,
          canConvertForOfflinePlayback: false,
        });
        setUploadStatus("ready");
        window.setTimeout(() => handleCancel(), 2000);
      } catch (err) {
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
        setConvertingFileIndex(null);
        activeXhrRef.current = null;
        cancelConversionTimeouts();
      }
    };

    const runMediaBatch = async (batch: MediaUploadBatch, retryFailedOnly = false) => {
      batch.cancelled = false;
      batch.active = true;
      batch.statusMessage = retryFailedOnly ? "Retrying failed files..." : batch.storagePolicy === "local-and-cloud" ? "Starting uploads..." : "Adding files...";
      publishBatch(batch);
      for (let index = 0; index < batch.files.length; index += 1) {
        const file = batch.files[index];
        if (batch.cancelled) break;
        if (file.status === "ready" || (retryFailedOnly && file.status !== "error")) continue;
        batch.currentFileIndex = index;
        try {
          await uploadSingleFile(batch, index);
        } catch {
          // Keep processing the remaining rows; the terminal transfer lists each failure.
        }
      }

      cancelBatchResources(batch);
      if (batch.cancelled) {
        batch.active = false;
        unregisterBatchAction(batch, "cancel");
        unregisterBatchAction(batch, "retry-failed");
        publishBatch(batch, "cancelled");
        return;
      }

      const failedCount = batch.files.filter((file) => file.status === "error").length;
      const succeededCount = batch.files.filter((file) => file.status === "ready").length;
      if (batch.storagePolicy === "local-and-cloud" && succeededCount > 0) onUploadComplete?.();
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
        files: selectedFiles.map((file, index) => ({ ...file, displayName: normalizedNames[index] })),
        storagePolicy,
        cancelled: false,
        xhr: null,
        timeouts: [],
        currentFileIndex: 0,
        active: true,
        statusMessage: "Starting uploads...",
        unregisterActions: [],
        registeredActions: new Map(),
      };
      batchesRef.current.set(batchId, batch);
      publishBatch(batch);
      const unregisterActions = () => batch.unregisterActions.forEach((unregister) => unregister());
      if (registerTransferAction) {
        registerBatchAction(batch, "cancel", () => {
          batch.cancelled = true;
          batch.active = false;
          batch.statusMessage = "Cancelling upload...";
          cancelBatchResources(batch);
          const cancelled = publishBatch(batch, "cancelled");
          unregisterBatchAction(batch, "cancel");
          unregisterBatchAction(batch, "retry-failed");
          updateTransfer?.({ ...cancelled, actions: [{ key: "dismiss", label: "Dismiss" }] });
        });
        registerBatchAction(batch, "retry-failed", async () => {
          if (!batch.files.some((file) => file.status === "error")) return;
          updateTransfer?.({ ...publishBatch(batch), actions: [{ key: "retry-failed", label: "Retrying failed files…", pending: true }, { key: "dismiss", label: "Dismiss" }] });
          await runMediaBatch(batch, true);
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
      void runMediaBatch(batch);
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
      cancelRequestedRef.current = false;
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

    useEffect(() => () => {
      batchesRef.current.forEach((batch) => {
        if (batch.active) {
          batch.cancelled = true;
          batch.active = false;
          cancelBatchResources(batch);
          const cancelled = publishBatch(batch, "cancelled");
          updateTransfer?.({ ...cancelled, actions: [{ key: "dismiss", label: "Dismiss" }] });
        } else if (batch.files.some((file) => file.status === "error")) {
          const terminal = publishBatch(batch, batch.files.some((file) => file.status === "ready") ? "partial" : "failed");
          updateTransfer?.({ ...terminal, actions: [{ key: "dismiss", label: "Dismiss" }] });
        }
        batch.unregisterActions.forEach((unregister) => unregister());
      });
      batchesRef.current.clear();
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
          size="sm"
          showCloseButton={!isUploading}
          zIndexLevel={2}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="media-upload-input" className="text-sm font-semibold">
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
                className={`relative flex flex-col items-center gap-2 rounded border border-dashed p-3 transition-colors ${isFileDragOver ? "border-blue-400 bg-blue-500/10" : "border-transparent"}`}
              >
                {isFileDragOver && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-blue-950/70 text-sm font-semibold text-blue-100">
                    Drop files to add media
                  </div>
                )}
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || uploadDisabled}
                  className="w-full justify-center"
                >
                  Choose Files
                </Button>
                <FileList
                  files={selectedFiles}
                  isUploading={isUploading}
                  onRemoveFile={handleRemoveFile}
                  onDisplayNameChange={updateFileDisplayName}
                />
              </div>
              {selectedFiles.length > 0 && (
                <div className="text-xs text-gray-400 text-center">
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

            <div className="flex flex-col gap-1">
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


            {error && <p className="text-red-500 text-sm">{error}</p>}

            {offlineConversionCandidates.length > 0 && !isUploading && (
              <div className="flex flex-col gap-2 rounded border border-amber-700/60 bg-amber-950/30 p-3">
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

            <div className="flex gap-2 justify-end mt-2">
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

            <div className="pt-4 border-t border-gray-700">
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
