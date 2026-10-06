import generateRandomId from "./generateRandomId";
import {
  cancelCloudinaryMediaUpload,
  deleteCloudinaryMediaAsset,
} from "../api/providerStorage";
import {
  enqueueLocalImageUploadJobAtomically,
  finishLocalImageUploadCancellationAtomically,
  getLocalImageUploadJob as getLocalImageUploadJobAtomically,
  requestLocalImageUploadCancellationAtomically,
  retryLocalImageUploadJobAtomically,
  subscribeLocalImageUploadJobChanges,
  type LocalImageUploadJob,
} from "./localImageAssets";

const activeUploads = new Map<string, XMLHttpRequest>();
const processingUploads = new Set<string>();
const cancelledUploads = new Set<string>();

export const enqueueLocalImageUpload = async ({
  assetId,
  itemId,
  workspaceId,
  uploadPreset,
  mediaId,
}: {
  assetId: string;
  itemId: string;
  workspaceId: string;
  uploadPreset: string;
  mediaId?: string;
}) => {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const job: LocalImageUploadJob = {
    id: assetId,
    assetId,
    itemId,
    workspaceId,
    uploadPreset,
    mediaId: mediaId || generateRandomId(),
    status: "pending",
    phase: "queued",
    progress: 0,
    attemptCount: 0,
    nextAttemptAt: 0,
    createdAt: now,
    updatedAt: now,
  };
  return enqueueLocalImageUploadJobAtomically(job, nowMs);
};

export const retryLocalImageUpload = (assetId: string) =>
  retryLocalImageUploadJobAtomically(assetId, Date.now());

export const getLocalImageUploadJob = (assetId: string) =>
  getLocalImageUploadJobAtomically(assetId);

export type LocalImageUploadActivityState = {
  status: "queued" | "uploading" | "committing" | "finalizing" | "complete" | "failed" | "cancelled";
  progress: number | null;
  phase: string;
  error?: string;
};

const toLocalImageUploadActivityState = (
  job: LocalImageUploadJob,
): LocalImageUploadActivityState => {
  if (job.status === "complete") {
    return { status: "complete", progress: 100, phase: "Upload complete" };
  }
  if (job.status === "cancelled") {
    return { status: "cancelled", progress: null, phase: "Upload cancelled" };
  }
  if (job.status === "failed") {
    if (job.cancelRequested) {
      return {
        status: "failed",
        progress: null,
        phase: "Upload cleanup failed",
        ...(job.lastError ? { error: job.lastError } : {}),
      };
    }
    if (job.nextAttemptAt > Date.now()) {
      return { status: "queued", progress: null, phase: "Retrying image upload" };
    }
    return {
      status: "failed",
      progress: null,
      phase: "Upload failed",
      ...(job.lastError ? { error: job.lastError } : {}),
    };
  }
  if (job.cancelRequested) {
    return { status: "uploading", progress: null, phase: "Stopping cloud upload…" };
  }
  if (job.status === "uploaded") {
    const status = job.phase === "finalizing" ? "finalizing" : "committing";
    return {
      status,
      progress: job.progress ?? 90,
      phase: status === "finalizing" ? "Updating Media" : "Saving cloud asset",
    };
  }
  if (job.status === "uploading") {
    return {
      status: "uploading",
      progress: job.progress ?? 0,
      phase: "Uploading image",
    };
  }
  return { status: "queued", progress: 0, phase: "Queued for cloud upload" };
};

export const waitForLocalImageUpload = (
  assetId: string,
  onState: (state: LocalImageUploadActivityState) => void = () => undefined,
) =>
  new Promise<LocalImageUploadJob>((resolve, reject) => {
    let finished = false;
    let checking = false;
    const finish = (error?: Error, job?: LocalImageUploadJob) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      if (error) reject(error);
      else if (job) resolve(job);
    };
    const inspect = async () => {
      if (finished || checking) return;
      checking = true;
      try {
        const job = await getLocalImageUploadJobAtomically(assetId);
        if (!job) {
          finish(new Error("The image upload stopped before completion."));
          return;
        }
        const state = toLocalImageUploadActivityState(job);
        onState(state);
        if (state.status === "complete") finish(undefined, job);
        else if (state.status === "cancelled") finish(new Error("Image upload cancelled."));
        else if (state.status === "failed") finish(new Error(state.error || "Image upload failed."));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("The image upload status could not be read."));
      } finally {
        checking = false;
      }
    };
    const unsubscribe = subscribeLocalImageUploadJobChanges((changedAssetId) => {
      if (changedAssetId === assetId) void inspect();
    });
    void inspect();
  });

export const registerLocalImageUploadRequest = (
  assetId: string,
  xhr: XMLHttpRequest,
) => {
  activeUploads.set(assetId, xhr);
};

export const clearLocalImageUploadRequest = (assetId: string) => {
  activeUploads.delete(assetId);
};

export const registerLocalImageUploadProcessing = (assetId: string) => {
  processingUploads.add(assetId);
};

export const clearLocalImageUploadProcessing = (assetId: string) => {
  processingUploads.delete(assetId);
};

export const consumeLocalImageUploadCancellation = (assetId: string) => {
  const wasCancelled = cancelledUploads.has(assetId);
  cancelledUploads.delete(assetId);
  return wasCancelled;
};

export const isLocalImageUploadCancellationRequested = (assetId: string) =>
  cancelledUploads.has(assetId);

export const signalLocalImageUploadCancellation = (assetId: string) => {
  cancelledUploads.add(assetId);
  activeUploads.get(assetId)?.abort();
};

export const retryLocalImageUploadCancellation = async (
  assetId: string,
  churchId: string,
) => {
  const job = await getLocalImageUploadJobAtomically(assetId);
  if (!job?.cancelRequested) return;
  if (job.leaseOwnerId && (job.leaseExpiresAt ?? 0) > Date.now()) {
    throw new Error("The upload is still stopping. Try cleanup again in a moment.");
  }
  if (job.providerUploadId) {
    const cleanup = await cancelCloudinaryMediaUpload(churchId, job.providerUploadId);
    if (cleanup.committed) {
      throw new Error("The image was saved before cancellation completed. Retry to finish the Media update.");
    }
  } else if (job.cloudMedia?.publicId) {
    await deleteCloudinaryMediaAsset(churchId, job.cloudMedia.publicId);
  }
  const finished = await finishLocalImageUploadCancellationAtomically(assetId, Date.now());
  if (finished?.status !== "cancelled") {
    throw new Error("The image upload could not be marked cancelled. Try again.");
  }
};

export const cancelLocalImageUpload = async (assetId: string) => {
  const current = await getLocalImageUploadJobAtomically(assetId);
  if (!current || current.status === "complete" || current.status === "cancelled") return;
  signalLocalImageUploadCancellation(assetId);
  await requestLocalImageUploadCancellationAtomically(assetId, Date.now());
  const requested = await getLocalImageUploadJobAtomically(assetId);
  if (requested?.status === "failed" && requested.cancelRequested && !requested.leaseOwnerId) {
    await retryLocalImageUploadCancellation(assetId, requested.workspaceId);
    return;
  }
  try {
    await waitForLocalImageUpload(assetId);
  } catch (error) {
    if (error instanceof Error && /cancelled/i.test(error.message)) return;
    throw error;
  }
};
