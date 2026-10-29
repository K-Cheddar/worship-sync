import type { ElectronLocalAsset, DesktopVideoDownloadEvent, DesktopVideoInspection } from "../../types/electron";
import type { MediaType } from "../../types";
import type { Transfer } from "../../context/transferModel";
import type { MuxUploadResult } from "../../containers/Media/MediaUploadInput.types";
import type { MuxUploadCallbacks } from "../../containers/Media/utils/muxUpload";

export type DesktopVideoDownloadOwner = {
  churchId: string;
  workspaceId: string;
  controllerProfileId: string;
  folderId: string | null;
  routePath: string;
  dbAtStart: object | undefined;
};

export type DesktopVideoDownloadInput = {
  inspection: DesktopVideoInspection;
  inspectedUrl: string;
  displayName: string;
  quality: number | "best";
  destination: "computer" | "cloud";
  owner: Omit<DesktopVideoDownloadOwner, "dbAtStart">;
};

export type DesktopVideoDownloadNative = {
  inspectVideoUrl: (url: string) => Promise<DesktopVideoInspection>;
  startVideoDownload: (input: { jobId: string; inspectionId: string; quality: number | "best" }) => Promise<{ jobId: string }>;
  cancelVideoDownload: (jobId: string) => Promise<boolean>;
  cleanupVideoDownload: (jobId: string) => Promise<unknown>;
  importDownloadedVideo: (input: { jobId: string; workspaceId: string; width: number; height: number }) => Promise<ElectronLocalAsset>;
  deleteLocalAsset: (assetId: string) => Promise<boolean>;
  onVideoDownloadProgress: (callback: (event: DesktopVideoDownloadEvent) => void) => () => void;
};

export type DesktopVideoDownloadDependencies = {
  native: DesktopVideoDownloadNative;
  getDatabase: () => object | undefined;
  isOwnerCurrent: (owner: DesktopVideoDownloadOwner) => boolean;
  createLocalMedia: (input: {
    asset: ElectronLocalAsset;
    owner: DesktopVideoDownloadOwner;
    displayName: string;
    duration: number;
    destination: "computer" | "cloud";
  }) => Promise<MediaType>;
  registerLocalMedia: (media: MediaType, owner: DesktopVideoDownloadOwner) => Promise<void>;
  registerCloudMedia: (media: MediaType, patch: Partial<MediaType>, owner: DesktopVideoDownloadOwner) => Promise<void>;
  removeUnregisteredLocalMedia: (media: MediaType | undefined, assetId: string | undefined) => Promise<void>;
  uploadToCloud: (
    jobId: string,
    fileName: string,
    options: { churchId: string; mediaId: string; title: string },
    callbacks: MuxUploadCallbacks,
  ) => Promise<MuxUploadResult>;
  buildCloudPatch: (media: MediaType, result: MuxUploadResult, churchId: string) => Partial<MediaType>;
  viewMedia: (media: MediaType, owner: DesktopVideoDownloadOwner) => void;
  notifyCloudStorageChanged: () => void;
  transfer: {
    updateTransfer: (transfer: Transfer) => void;
    removeTransfer: (id: string) => void;
    registerTransferAction: (id: string, key: string, handler: () => void | Promise<void>) => () => void;
  };
  makeJobId?: () => string;
};

type Stage = "Preparing" | "Downloading" | "Processing" | "Importing" | "Uploading" | "Complete" | "Failed" | "Cancelled";
type Runtime = {
  jobId: string;
  transferId: string;
  inspectionId: string;
  inspectedUrl: string;
  displayName: string;
  quality: number | "best";
  destination: "computer" | "cloud";
  owner: DesktopVideoDownloadOwner;
  downloadFinished: boolean;
  mediaInfo?: { width: number; height: number; duration: number; size: number };
  asset?: ElectronLocalAsset;
  media?: MediaType;
  localMediaRegistered: boolean;
  cloudResult?: MuxUploadResult;
  cloudMediaRegistered: boolean;
  nativeCleaned: boolean;
  cancelRequested: boolean;
  ownerChanged: boolean;
  busy: boolean;
  operation?: Promise<void>;
  cancelPromise?: Promise<void>;
  cleanupPromise?: Promise<void>;
  assetCleanupPromise?: Promise<void>;
  cancelCloudUpload?: () => Promise<void>;
  retryMuxCleanup?: () => Promise<void>;
  lastBytes?: { downloadedBytes?: number; totalBytes?: number };
  progress: number | null;
  stage: Stage;
  status: Transfer["status"];
  detail?: string;
  error?: string;
  cleanupError?: string;
  unregisterActions: Array<() => void>;
};

const randomJobId = () => globalThis.crypto.randomUUID();
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const friendlyBytes = (bytes?: number) => {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** Feature-specific owner for desktop video jobs. The instance is mounted with TransferProvider, above routes. */
export class DesktopVideoDownloadManager {
  private readonly jobs = new Map<string, Runtime>();
  private stopProgress?: () => void;

  constructor(private readonly deps: DesktopVideoDownloadDependencies) {}

  start(input: DesktopVideoDownloadInput) {
    const jobId = this.deps.makeJobId?.() ?? randomJobId();
    const owner: DesktopVideoDownloadOwner = { ...input.owner, dbAtStart: this.deps.getDatabase() };
    if (!this.deps.isOwnerCurrent(owner)) throw new Error("The active church changed. Reopen the downloader and try again.");
    if (input.destination === "cloud" && !owner.churchId) throw new Error("Cloud storage is unavailable for this account.");
    const runtime: Runtime = {
      jobId,
      transferId: `video-download-${jobId}`,
      inspectionId: input.inspection.inspectionId,
      inspectedUrl: input.inspectedUrl,
      displayName: input.displayName,
      quality: input.quality,
      destination: input.destination,
      owner,
      downloadFinished: false,
      localMediaRegistered: false,
      cloudMediaRegistered: false,
      nativeCleaned: false,
      cancelRequested: false,
      ownerChanged: false,
      busy: false,
      progress: 0,
      stage: "Preparing",
      status: "active",
      unregisterActions: [],
    };
    this.jobs.set(jobId, runtime);
    this.registerActions(runtime);
    this.publish(runtime, "active", "Preparing", 0, "Preparing video download");
    void this.startNativeDownload(runtime, false);
    return jobId;
  }

  attachProgressListener() {
    this.stopProgress?.();
    this.stopProgress = this.deps.native.onVideoDownloadProgress((event) => this.handleProgress(event));
    return () => {
      this.stopProgress?.();
      this.stopProgress = undefined;
    };
  }

  handleProgress(event: DesktopVideoDownloadEvent): void | Promise<void> {
    const runtime = this.jobs.get(event.jobId);
    if (!runtime) return;
    if (event.downloadedBytes !== undefined || event.totalBytes !== undefined) {
      runtime.lastBytes = { downloadedBytes: event.downloadedBytes, totalBytes: event.totalBytes };
    }
    runtime.progress = event.progress;
    if (event.stage === "preparing") this.publish(runtime, "active", "Preparing", event.progress);
    if (event.stage === "downloading") this.publish(runtime, "active", "Downloading", event.progress);
    if (event.stage === "processing") this.publish(runtime, "active", "Processing", null, "Merging video and audio");
    if (event.stage === "uploading") this.publish(runtime, "active", "Uploading", event.progress);
    if (event.stage === "complete" && event.result) {
      if (runtime.cancelRequested) {
        void this.cancelJob(runtime, runtime.ownerChanged);
        return;
      }
      runtime.downloadFinished = true;
      runtime.mediaInfo = event.result;
      runtime.progress = 100;
      return this.runPipeline(runtime);
    }
    if (event.stage === "failed") {
      if (runtime.cancelRequested) {
        void this.cancelJob(runtime, runtime.ownerChanged);
        return;
      }
      runtime.busy = false;
      this.publish(runtime, "failed", "Failed", null, "Download failed", event.error ?? "The video could not be downloaded.");
    }
    if (event.stage === "cancelled") {
      runtime.cancelRequested = true;
      void this.cancelJob(runtime, runtime.ownerChanged);
    }
  }

  handleChurchChange(churchId: string) {
    for (const runtime of this.jobs.values()) {
      const currentOwner = runtime.owner.churchId === churchId && this.deps.isOwnerCurrent(runtime.owner);
      if (!currentOwner && this.isActive(runtime)) {
        runtime.ownerChanged = true;
        void this.cancelJob(runtime, true);
      } else if (!this.isActive(runtime)) {
        this.publish(runtime, runtime.status, runtime.stage, runtime.progress, runtime.detail, runtime.error);
      }
    }
  }

  private isActive(runtime: Runtime) {
    return runtime.busy || runtime.stage === "Preparing" || runtime.stage === "Downloading" || runtime.stage === "Processing" || runtime.stage === "Importing" || runtime.stage === "Uploading";
  }

  private registerActions(runtime: Runtime) {
    const id = runtime.transferId;
    runtime.unregisterActions = [
      this.deps.transfer.registerTransferAction(id, "cancel", () => this.cancelJob(runtime, false)),
      this.deps.transfer.registerTransferAction(id, "retry", () => this.retryJob(runtime)),
      this.deps.transfer.registerTransferAction(id, "retry-cleanup", () => this.retryCleanup(runtime)),
      this.deps.transfer.registerTransferAction(id, "dismiss", () => this.dismissJob(runtime)),
      this.deps.transfer.registerTransferAction(id, "view", () => {
        if (runtime.media && runtime.localMediaRegistered && this.deps.isOwnerCurrent(runtime.owner)) {
          this.deps.viewMedia(runtime.media, runtime.owner);
        }
      }),
    ];
  }

  private publish(
    runtime: Runtime,
    status: Transfer["status"],
    stage: Stage,
    progress: number | null,
    detail?: string,
    error?: string,
    explicitActions?: Transfer["actions"],
  ) {
    runtime.stage = stage;
    runtime.status = status;
    runtime.progress = progress;
    runtime.error = error;
    runtime.detail = detail;
    const downloaded = runtime.lastBytes?.downloadedBytes;
    const total = runtime.lastBytes?.totalBytes;
    const bytes = downloaded === undefined ? undefined : `${stage === "Uploading" ? "Uploaded" : "Downloaded"} ${friendlyBytes(downloaded)}${total === undefined ? "" : ` of ${friendlyBytes(total)}`}`;
    const actions = explicitActions ?? (status === "active" || status === "queued"
      ? [{ key: "cancel", label: "Cancel" }]
      : status === "failed"
        ? [
            ...(runtime.cleanupError || runtime.retryMuxCleanup ? [{ key: "retry-cleanup", label: "Retry cleanup" }] : []),
            { key: "retry", label: runtime.localMediaRegistered && !runtime.cloudMediaRegistered ? "Retry upload" : "Retry" },
            { key: "dismiss", label: "Dismiss" },
          ]
        : status === "complete"
          ? [
              ...(runtime.cleanupError ? [{ key: "retry-cleanup", label: "Retry cleanup" }] : []),
              { key: "dismiss", label: "Dismiss" },
            ]
          : [{ key: "dismiss", label: "Dismiss" }]);
    this.deps.transfer.updateTransfer({
      id: runtime.transferId,
      type: "Media upload",
      name: `${runtime.displayName}.mp4`,
      status,
      progress: progress === null ? null : Math.max(0, Math.min(100, Math.round(progress))),
      phase: { key: stage.toLowerCase(), label: stage },
      ...(detail || bytes ? { detail: [detail, bytes].filter(Boolean).join(" · ") } : {}),
      ...(runtime.media && runtime.localMediaRegistered && this.deps.isOwnerCurrent(runtime.owner)
        ? { result: { label: "View in Media Library", actionKey: "view" } }
        : {}),
      ...(error ? { error: { message: error } } : {}),
      canCancel: status === "active" || status === "queued",
      blocksUnload: false,
      actions,
    });
  }

  private async startNativeDownload(runtime: Runtime, refreshingInspection: boolean) {
    try {
      if (refreshingInspection) {
        const inspection = await this.deps.native.inspectVideoUrl(runtime.inspectedUrl);
        if (!inspection.heights.includes(runtime.quality as number) && runtime.quality !== "best") {
          throw new Error("The selected video quality is no longer available. Choose a new quality in the downloader.");
        }
        runtime.inspectionId = inspection.inspectionId;
      }
      if (runtime.cancelRequested) return;
      runtime.nativeCleaned = false;
      const started = await this.deps.native.startVideoDownload({
        jobId: runtime.jobId,
        inspectionId: runtime.inspectionId,
        quality: runtime.quality,
      });
      if (started.jobId !== runtime.jobId) throw new Error("The video download could not be started.");
      if (runtime.cancelRequested) await this.deps.native.cancelVideoDownload(runtime.jobId);
    } catch (error) {
      if (runtime.cancelRequested) return;
      this.publish(runtime, "failed", "Failed", null, "Download failed", messageOf(error, "The video download could not be started."));
    }
  }

  private async runPipeline(runtime: Runtime) {
    if (runtime.busy || !runtime.downloadFinished) return;
    runtime.busy = true;
    const operation = this.performPipeline(runtime);
    runtime.operation = operation;
    try {
      await operation;
    } finally {
      if (runtime.operation === operation) runtime.operation = undefined;
      runtime.busy = false;
    }
  }

  private async performPipeline(runtime: Runtime) {
    try {
      const info = runtime.mediaInfo;
      if (!info) throw new Error("The downloaded video details are missing.");
      this.assertCurrentOwner(runtime);
      if (!runtime.asset) {
        this.publish(runtime, "active", "Importing", null, "Validating the downloaded MP4");
        runtime.asset = await this.deps.native.importDownloadedVideo({
          jobId: runtime.jobId,
          workspaceId: runtime.owner.workspaceId,
          width: info.width,
          height: info.height,
        });
      }
      if (runtime.cancelRequested && !runtime.localMediaRegistered) {
        await this.removeUnregisteredAsset(runtime);
        return this.finishCancellation(runtime);
      }
      if (!runtime.media) {
        runtime.media = await this.deps.createLocalMedia({
          asset: runtime.asset,
          owner: runtime.owner,
          displayName: runtime.displayName,
          duration: info.duration,
          destination: runtime.destination,
        });
      }
      if (runtime.cancelRequested && !runtime.localMediaRegistered) {
        await this.removeUnregisteredAsset(runtime);
        return this.finishCancellation(runtime);
      }
      if (!runtime.localMediaRegistered) {
        this.assertCurrentOwner(runtime);
        runtime.media = { ...runtime.media, folderId: runtime.owner.folderId };
        await this.deps.registerLocalMedia(runtime.media, runtime.owner);
        runtime.localMediaRegistered = true;
      }
      if (runtime.cancelRequested) {
        await this.cleanupNative(runtime);
        return this.finishCancellation(runtime);
      }
      if (runtime.destination === "cloud" && !runtime.cloudMediaRegistered) {
        if (!runtime.cloudResult) {
          this.assertCurrentOwner(runtime);
          this.publish(runtime, "active", "Uploading", 0, "Uploading video to WorshipSync");
          runtime.cloudResult = await this.deps.uploadToCloud(
            runtime.jobId,
            `${runtime.displayName}.mp4`,
            { churchId: runtime.owner.churchId, mediaId: runtime.media.id, title: runtime.displayName },
            {
              isCancelled: () => runtime.cancelRequested,
              setCancelUpload: (cancel) => { runtime.cancelCloudUpload = cancel; },
              onProgress: (progress) => this.publish(runtime, "active", "Uploading", progress),
              onStatusUpdate: (status) => this.publish(runtime, "active", "Uploading", null, status),
            },
          );
        }
        if (runtime.cancelRequested) throw new Error("Upload cancelled.");
        this.assertCurrentOwner(runtime);
        const patch = this.deps.buildCloudPatch(runtime.media, runtime.cloudResult, runtime.owner.churchId);
        await this.deps.registerCloudMedia(runtime.media, patch, runtime.owner);
        runtime.media = { ...runtime.media, ...patch };
        runtime.cloudMediaRegistered = true;
        this.deps.notifyCloudStorageChanged();
      }
      if (runtime.cancelRequested) {
        await this.cleanupNative(runtime);
        return this.finishCancellation(runtime);
      }
      await this.cleanupNative(runtime);
      this.publish(runtime, "complete", "Complete", 100, runtime.destination === "cloud" ? "Uploaded and added to Media Library" : "Added to Media Library");
    } catch (error) {
      const failedStage = runtime.stage;
      const cleanup = error && typeof error === "object" ? (error as { retryCleanup?: () => Promise<void> }).retryCleanup : undefined;
      if (cleanup) runtime.retryMuxCleanup = cleanup;
      if (runtime.cancelRequested) {
        if (!runtime.localMediaRegistered) await this.removeUnregisteredAsset(runtime).catch(() => undefined);
        await this.cleanupNative(runtime).catch((cleanupError) => {
          runtime.cleanupError = messageOf(cleanupError, "Temporary download cleanup is pending.");
        });
        if (runtime.ownerChanged || !this.deps.isOwnerCurrent(runtime.owner)) {
          this.publish(runtime, "failed", "Failed", null, "The church changed while the video was being processed. Switch back to the original church to retry.", "This job belongs to a different church.");
        } else if (runtime.cleanupError) {
          this.publish(runtime, "failed", "Failed", null, "Cleanup failed", runtime.cleanupError);
        } else {
          await this.finishCancellation(runtime);
        }
        return;
      }
      if (runtime.cleanupError && runtime.localMediaRegistered &&
        (runtime.destination === "computer" || runtime.cloudMediaRegistered)) {
        this.publish(runtime, "complete", "Complete", 100,
          "Video is available in Media Library. Temporary download cleanup is pending.", runtime.cleanupError);
        return;
      }
      runtime.error = messageOf(error, "The video could not be imported.");
      const uploadFailed = failedStage === "Uploading" || (runtime.localMediaRegistered && runtime.destination === "cloud");
      this.publish(runtime, "failed", "Failed", null,
        uploadFailed
          ? "Upload failed. The local video remains available in Media Library."
          : runtime.localMediaRegistered
            ? "Media Library registration needs to be retried."
            : "The finished video remains on this computer. Retry to import it.",
        runtime.error);
    } finally {
      runtime.cancelCloudUpload = undefined;
    }
  }

  private async retryJob(runtime: Runtime) {
    if (runtime.busy) return;
    if (runtime.retryMuxCleanup) {
      try {
        await runtime.retryMuxCleanup();
        runtime.retryMuxCleanup = undefined;
      } catch (error) {
        runtime.cleanupError = messageOf(error, "Mux cleanup is still pending.");
        this.publish(runtime, "failed", "Failed", null, "Cleanup failed", runtime.cleanupError);
        return;
      }
    }
    runtime.error = undefined;
    runtime.cancelRequested = false;
    runtime.ownerChanged = false;
    if (runtime.downloadFinished) {
      await this.runPipeline(runtime);
      return;
    }
    if (!this.deps.isOwnerCurrent(runtime.owner)) {
      this.publish(runtime, "failed", "Failed", null, undefined, "Switch back to the church where this download started to retry it.");
      return;
    }
    this.publish(runtime, "active", "Preparing", 0, "Retrying video download");
    await this.startNativeDownload(runtime, true);
  }

  private async retryCleanup(runtime: Runtime) {
    if (runtime.busy) return;
    runtime.busy = true;
    try {
      if (runtime.retryMuxCleanup) {
        await runtime.retryMuxCleanup();
        runtime.retryMuxCleanup = undefined;
      }
      if (!runtime.localMediaRegistered) {
        await this.removeUnregisteredAsset(runtime);
        await this.cleanupNative(runtime);
        runtime.downloadFinished = false;
        runtime.mediaInfo = undefined;
      } else if (runtime.destination === "computer" || runtime.cloudMediaRegistered) {
        await this.cleanupNative(runtime);
      }
      runtime.cleanupError = undefined;
      if (runtime.localMediaRegistered && (runtime.destination === "computer" || runtime.cloudMediaRegistered)) {
        this.publish(runtime, "complete", "Complete", 100, "Added to Media Library");
      } else {
        this.publish(runtime, "failed", "Failed", null,
          runtime.localMediaRegistered ? "Upload failed. The local video remains available in Media Library." : "Import failed.",
          runtime.error ?? "The operation still needs to be retried.");
      }
    } catch (error) {
      runtime.cleanupError = messageOf(error, "Cleanup is still pending.");
      this.publish(runtime, "failed", "Failed", null, "Cleanup failed", runtime.cleanupError);
    } finally {
      runtime.busy = false;
    }
  }

  private async cancelJob(runtime: Runtime, ownerChanged: boolean) {
    if (runtime.cancelPromise) return runtime.cancelPromise;
    if (!this.isActive(runtime) && !runtime.busy) return;
    runtime.cancelRequested = true;
    runtime.ownerChanged ||= ownerChanged;
    const cancellation = (async () => {
      await Promise.allSettled([
        this.deps.native.cancelVideoDownload(runtime.jobId),
        runtime.cancelCloudUpload?.(),
      ].filter(Boolean) as Promise<unknown>[]);
      await runtime.operation?.catch(() => undefined);
      if (!runtime.localMediaRegistered) {
        try {
          await this.removeUnregisteredAsset(runtime);
        } catch (error) {
          runtime.cleanupError = messageOf(error, "Unfinished local media cleanup is pending.");
        }
      }
      try {
        await this.cleanupNative(runtime);
      } catch (error) {
        runtime.cleanupError = messageOf(error, "Temporary download cleanup is pending.");
      }
      if (runtime.ownerChanged || !this.deps.isOwnerCurrent(runtime.owner)) {
        this.publish(runtime, "failed", "Failed", null, "This job belongs to the church where it was started.", runtime.cleanupError ?? "Switch back to the original church to retry it.");
      } else if (runtime.cleanupError) {
        this.publish(runtime, "failed", "Failed", null, "Cleanup failed", runtime.cleanupError);
      } else {
        await this.finishCancellation(runtime);
      }
    })();
    runtime.cancelPromise = cancellation;
    try {
      await cancellation;
    } finally {
      if (runtime.cancelPromise === cancellation) runtime.cancelPromise = undefined;
    }
  }

  private async finishCancellation(runtime: Runtime) {
    runtime.busy = false;
    runtime.stage = "Cancelled";
    this.publish(runtime, "cancelled", "Cancelled", null, runtime.localMediaRegistered ? "Local video remains in Media Library" : "Download cancelled");
  }

  private async cleanupNative(runtime: Runtime) {
    if (runtime.nativeCleaned) return;
    if (runtime.cleanupPromise) return runtime.cleanupPromise;
    const cleanup = this.deps.native.cleanupVideoDownload(runtime.jobId).then(() => {
      runtime.nativeCleaned = true;
      runtime.cleanupError = undefined;
    }, (error: unknown) => {
      runtime.cleanupError = messageOf(error, "Temporary download cleanup is pending.");
      throw error;
    });
    runtime.cleanupPromise = cleanup;
    try {
      await cleanup;
    } finally {
      if (runtime.cleanupPromise === cleanup) runtime.cleanupPromise = undefined;
    }
  }

  private async removeUnregisteredAsset(runtime: Runtime) {
    if (!runtime.asset && !runtime.media) return;
    if (runtime.assetCleanupPromise) return runtime.assetCleanupPromise;
    const assetId = runtime.media?.localVideoFile?.id ?? runtime.asset?.assetId;
    const cleanup = (async () => {
      if (assetId) await this.deps.removeUnregisteredLocalMedia(runtime.media, assetId);
      runtime.media = undefined;
      runtime.asset = undefined;
    })();
    runtime.assetCleanupPromise = cleanup;
    try {
      await cleanup;
    } finally {
      if (runtime.assetCleanupPromise === cleanup) runtime.assetCleanupPromise = undefined;
    }
  }

  private async dismissJob(runtime: Runtime) {
    if (runtime.busy || this.isActive(runtime)) return;
    try {
      if (runtime.retryMuxCleanup) {
        await runtime.retryMuxCleanup();
        runtime.retryMuxCleanup = undefined;
      }
      if (!runtime.localMediaRegistered) await this.removeUnregisteredAsset(runtime);
      await this.cleanupNative(runtime);
    } catch (error) {
      runtime.cleanupError = messageOf(error, "Cleanup is still pending.");
      this.publish(runtime, "failed", "Failed", null, "Cleanup failed", runtime.cleanupError);
      return;
    }
    this.jobs.delete(runtime.jobId);
    runtime.unregisterActions.forEach((unregister) => unregister());
    runtime.unregisterActions = [];
    this.deps.transfer.removeTransfer(runtime.transferId);
  }

  private assertCurrentOwner(runtime: Runtime) {
    if (!this.deps.isOwnerCurrent(runtime.owner)) {
      runtime.ownerChanged = true;
      throw new Error("The active church changed while this video was being processed. Switch back to the original church to retry.");
    }
  }
}
