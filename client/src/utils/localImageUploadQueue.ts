import generateRandomId from "./generateRandomId";
import {
  deleteLocalImageUploadJob,
  enqueueLocalImageUploadJobAtomically,
  retryLocalImageUploadJobAtomically,
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
}: {
  assetId: string;
  itemId: string;
  workspaceId: string;
  uploadPreset: string;
}) => {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const job: LocalImageUploadJob = {
    id: assetId,
    assetId,
    itemId,
    workspaceId,
    uploadPreset,
    mediaId: generateRandomId(),
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: 0,
    createdAt: now,
    updatedAt: now,
  };
  return enqueueLocalImageUploadJobAtomically(job, nowMs);
};

export const retryLocalImageUpload = (assetId: string) =>
  retryLocalImageUploadJobAtomically(assetId, Date.now());

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

export const cancelLocalImageUpload = async (assetId: string) => {
  const activeUpload = activeUploads.get(assetId);
  if (activeUpload || processingUploads.has(assetId)) {
    cancelledUploads.add(assetId);
    activeUpload?.abort();
  }
  activeUploads.delete(assetId);
  await deleteLocalImageUploadJob(assetId);
  if (!processingUploads.has(assetId)) return;
  await new Promise<void>((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (!processingUploads.has(assetId) || Date.now() - startedAt >= 10_000) {
        resolve();
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  });
};
