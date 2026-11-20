import {
  cancelChurchMuxUpload,
  createChurchMuxUpload,
  deleteChurchMuxAsset,
  getChurchMuxAsset,
  getChurchMuxUpload,
} from "../../../api/providerStorage";
import { MuxUploadResult } from "../MediaUploadInput.types";

type PollingCallbacks = {
  onProgress?: (progress: number) => void;
  onStatusUpdate?: (message: string) => void;
  onStageUpdate?: (stage: "creating" | "uploading" | "processing", message: string) => void;
  isCancelled?: () => boolean;
  requireStaticRendition?: boolean;
  addTimeout?: (timeoutId: NodeJS.Timeout, cancel: () => void) => void;
};

export type MuxUploadCallbacks = PollingCallbacks & {
  setXhr?: (xhr: XMLHttpRequest) => void;
  setCancelUpload?: (cancel: (() => Promise<void>) | undefined) => void;
};

export type MuxUploadFailureStage =
  | "creation"
  | "validation"
  | "file-read"
  | "transport"
  | "processing"
  | "cleanup";

export class MuxUploadError extends Error {
  constructor(readonly stage: MuxUploadFailureStage, message: string) {
    super(message);
    this.name = "MuxUploadError";
  }
}

const safeMuxErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;
  return message
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\?[^\s"'<>]*/g, "?[redacted]")
    .replace(/\b(cookie|authorization|token|signature|sig|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600) || fallback;
};

const logMuxUploadFailure = (stage: string, error: unknown) => {
  console.warn("[MuxUpload] operation failed", {
    stage,
    diagnostics: safeMuxErrorMessage(error, "No diagnostic was returned."),
  });
};

const makeMuxUploadError = (stage: MuxUploadFailureStage, error: unknown) => {
  if (error instanceof MuxUploadError) return error;
  const detail = safeMuxErrorMessage(error, "Video upload failed.");
  if (/upload cancelled/i.test(detail)) return new MuxUploadError(stage, "Cloud upload cancelled.");
  if (stage === "creation") return new MuxUploadError(stage, `Could not create the cloud upload. ${detail}`);
  if (stage === "validation") return new MuxUploadError(stage, "The cloud upload address is invalid. Retry the cloud upload or contact support.");
  if (stage === "file-read") return new MuxUploadError(stage, "The local video could not be read. Check that it is available and retry.");
  if (stage === "processing") return new MuxUploadError(stage, `Cloud video processing failed. ${detail}`);
  if (stage === "cleanup") return new MuxUploadError(stage, `Mux cleanup failed. ${detail}`);
  const httpStatus = detail.match(/\bHTTP (\d{3})\b/i)?.[1];
  if (httpStatus) return new MuxUploadError(stage, `The cloud service rejected the video upload (HTTP ${httpStatus}).`);
  if (/timed? out|timeout/i.test(detail)) {
    return new MuxUploadError(stage, "The cloud upload timed out. Check your connection and retry.");
  }
  if (/cloud upload address is invalid/i.test(detail)) {
    return makeMuxUploadError("validation", error);
  }
  if (/local video could not be read/i.test(detail)) {
    return makeMuxUploadError("file-read", error);
  }
  if (/cloud upload connection/i.test(detail)) {
    return new MuxUploadError(stage, detail);
  }
  return new MuxUploadError(stage, detail);
};

export type MuxUploadOptions = {
  churchId: string;
  mediaId?: string;
  title?: string;
  temporary?: boolean;
};

const waitForPollingInterval = async (
  callbacks: PollingCallbacks,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      settled = true;
      resolve();
    }, 5000);
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error("Upload cancelled"));
    };
    callbacks.addTimeout?.(timeoutId, cancel);
  });

export const pollUploadStatus = async (
  uploadId: string,
  churchId: string,
  callbacks: PollingCallbacks = {},
): Promise<string | null> => {
  const maxAttempts = 60; // 5 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (callbacks.isCancelled?.()) {
      throw new Error("Upload cancelled");
    }

    try {
      const data = await getChurchMuxUpload(churchId, uploadId);

      if (data.status === "asset_created" && data.assetId) {
        return data.assetId;
      } else if (data.status === "errored") {
        throw new Error("Upload failed");
      }

      await waitForPollingInterval(callbacks);
      attempts++;
    } catch (err) {
      if (callbacks.isCancelled?.()) {
        throw new Error("Upload cancelled");
      }
      logMuxUploadFailure("upload-status-polling", err);
      throw err;
    }
  }

  throw new Error("Upload timeout");
};

export const pollAssetStatus = async (
  assetId: string,
  churchId: string,
  callbacks: PollingCallbacks = {},
): Promise<{
  playbackId: string;
  assetId: string;
  staticRenditionReady: boolean;
  durationSeconds: number;
}> => {
  const maxAttempts = 120; // 10 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (callbacks.isCancelled?.()) {
      throw new Error("Upload cancelled");
    }

    try {
      const data = await getChurchMuxAsset(churchId, assetId);

      const staticRenditionReady = data.staticRenditionReady === true;
      if (
        data.status === "ready" &&
        data.playbackId &&
        (!callbacks.requireStaticRendition || staticRenditionReady)
      ) {
        return {
          playbackId: data.playbackId,
          assetId,
          staticRenditionReady,
          durationSeconds: Number(data.duration),
        };
      } else if (data.status === "errored") {
        throw new Error("Asset processing failed");
      }

      callbacks.onStatusUpdate?.(
        callbacks.requireStaticRendition && data.status === "ready"
          ? `Preparing offline video... (${attempts * 5}s)`
          : `Processing video... (${attempts * 5}s)`,
      );
      
      await waitForPollingInterval(callbacks);
      attempts++;
    } catch (err) {
      if (callbacks.isCancelled?.()) {
        throw new Error("Upload cancelled");
      }
      logMuxUploadFailure("asset-status-polling", err);
      throw err;
    }
  }

  throw new Error("Processing timeout");
};

export const deleteMuxAsset = async (
  assetId: string,
  churchId: string,
): Promise<void> => {
  await deleteChurchMuxAsset(churchId, assetId);
};

export const downloadMuxMp4 = async (
  result: MuxUploadResult,
  callbacks: MuxUploadCallbacks = {},
): Promise<File> => {
  const downloadUrl =
    result.mp4Url || `https://stream.mux.com/${result.playbackId}/highest.mp4`;
  const xhr = new XMLHttpRequest();
  callbacks.setXhr?.(xhr);

  return new Promise<File>((resolve, reject) => {
    if (callbacks.isCancelled?.()) {
      reject(new Error("Conversion cancelled"));
      return;
    }
    xhr.open("GET", downloadUrl);
    xhr.responseType = "blob";
    xhr.addEventListener("progress", (event) => {
      if (callbacks.isCancelled?.()) {
        xhr.abort();
        return;
      }
      if (event.lengthComputable) {
        callbacks.onProgress?.((event.loaded / event.total) * 100);
      }
    });
    xhr.addEventListener("load", () => {
      if (callbacks.isCancelled?.()) {
        reject(new Error("Conversion cancelled"));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(
            `Converted video download failed with status ${xhr.status}.`,
          ),
        );
        return;
      }
      const blob = xhr.response;
      if (!(blob instanceof Blob) || blob.size <= 0) {
        reject(new Error("The converted video was empty."));
        return;
      }
      resolve(
        new File(
          [blob],
          `${result.name || "converted-video"}.mp4`,
          { type: "video/mp4" },
        ),
      );
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Converted video download failed.")),
    );
    xhr.addEventListener("abort", () =>
      reject(new Error("Conversion cancelled")),
    );
    xhr.send();
  });
};

export const convertMuxVideoToLocalMp4 = async (
  file: File,
  churchId: string,
  callbacks: MuxUploadCallbacks = {},
): Promise<File> => {
  let temporaryAssetId: string | undefined;
  let operationFailed = false;
  try {
    const result = await uploadVideoToMux(file, { churchId, title: file.name, temporary: true }, {
      ...callbacks,
      requireStaticRendition: true,
    });
    temporaryAssetId = result.assetId;
    callbacks.onStatusUpdate?.("Downloading converted video...");
    return await downloadMuxMp4(result, callbacks);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    if (temporaryAssetId) {
      try {
        await deleteMuxAsset(temporaryAssetId, churchId);
      } catch (cleanupError) {
        if (!operationFailed) throw cleanupError;
        console.error("Could not remove failed temporary Mux asset:", cleanupError);
      }
    }
  }
};

const uploadVideoToMuxFromSource = async (
  fileName: string,
  options: MuxUploadOptions,
  callbacks: MuxUploadCallbacks = {},
  uploadFile: (
    uploadUrl: string,
    setCancelTransport: (cancel: () => Promise<void>) => void,
  ) => Promise<void>,
): Promise<MuxUploadResult> => {
  callbacks.onStageUpdate?.("creating", "Creating cloud upload");
  let uploadId: string;
  let uploadUrl: string;
  try {
    ({ uploadId, url: uploadUrl } = await createChurchMuxUpload(
      options.churchId,
      {
        mediaId: options.mediaId || "",
        title: options.title || fileName,
        temporary: options.temporary,
      },
    ));
  } catch (error) {
    const failure = makeMuxUploadError("creation", error);
    logMuxUploadFailure("creation", failure);
    throw failure;
  }

  let assetId: string | undefined;
  let cancelPromise: Promise<void> | undefined;
  let cancelTransport: (() => Promise<void>) | undefined;
  const cancelAndCleanUpload = () => {
    if (cancelPromise) return cancelPromise;
    const attempt = (async () => {
      const results = await Promise.allSettled([
        cancelTransport?.(),
        cancelChurchMuxUpload(options.churchId, uploadId).then((upload) => {
          assetId = upload.assetId || assetId;
          return assetId ? deleteMuxAsset(assetId, options.churchId) : undefined;
        }),
      ].filter(Boolean) as Promise<unknown>[]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })();
    cancelPromise = attempt.catch((error) => {
      cancelPromise = undefined;
      throw error;
    });
    return cancelPromise;
  };
  callbacks.setCancelUpload?.(cancelAndCleanUpload);

  let failureStage: MuxUploadFailureStage = "transport";
  try {
    if (callbacks.isCancelled?.()) throw new Error("Upload cancelled");
    // The Media Library owns the upload intent and Mux registration. The
    // source-specific transport changes for disk-backed downloads only.
    callbacks.onStageUpdate?.("uploading", "Uploading video");
    try {
      await uploadFile(uploadUrl, (cancel) => { cancelTransport = cancel; });
    } catch (error) {
      const detail = safeMuxErrorMessage(error, "Video upload failed.");
      failureStage = /cloud upload address is invalid/i.test(detail)
        ? "validation"
        : /local video could not be read/i.test(detail)
          ? "file-read"
          : "transport";
      throw makeMuxUploadError(failureStage, error);
    }

    failureStage = "processing";
    callbacks.onStageUpdate?.("processing", "Waiting for cloud video processing");
    callbacks.onStatusUpdate?.("Processing upload...");
    const polledAssetId = await pollUploadStatus(uploadId, options.churchId, callbacks);
    if (!polledAssetId) throw new Error("Failed to get asset ID");
    assetId = polledAssetId;

    callbacks.onStatusUpdate?.("Processing video...");
    const { playbackId, assetId: finalAssetId, durationSeconds } =
      await pollAssetStatus(assetId, options.churchId, callbacks);

    const playbackUrl = `https://stream.mux.com/${playbackId}.m3u8`;
    const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.png?width=250&height=141&fit_mode=pad&time=1`;
    const name = fileName.replace(/\.[^/.]+$/, "");
    const result = {
      playbackId,
      assetId: finalAssetId,
      playbackUrl,
      mp4Url: `https://stream.mux.com/${playbackId}/highest.mp4`,
      thumbnailUrl,
      name,
      durationSeconds,
    };
    // Once Mux has finished creating the asset, cancellation must not delete
    // it while the caller persists the Media Library reference.
    callbacks.setCancelUpload?.(undefined);
    return result;
  } catch (error) {
    const failure = makeMuxUploadError(failureStage, error);
    if (failure.message !== "Cloud upload cancelled.") logMuxUploadFailure(failure.stage, failure);
    try {
      await cancelAndCleanUpload();
    } catch (cleanupError) {
      logMuxUploadFailure("cleanup", cleanupError);
      const cleanupFailure = makeMuxUploadError("cleanup", cleanupError);
      const combined = new MuxUploadError("cleanup", `${failure.message} ${cleanupFailure.message}`);
      Object.assign(combined, {
        cleanupFailed: true,
        ...(assetId ? { assetId } : {}),
        retryCleanup: cancelAndCleanUpload,
      });
      callbacks.setCancelUpload?.(undefined);
      throw combined;
    }
    callbacks.setCancelUpload?.(undefined);
    throw failure;
  }
};

export const uploadVideoToMux = (
  file: File,
  options: MuxUploadOptions,
  callbacks: MuxUploadCallbacks = {},
): Promise<MuxUploadResult> =>
  uploadVideoToMuxFromSource(file.name, options, callbacks, (uploadUrl) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      callbacks.setXhr?.(xhr);
      if (callbacks.isCancelled?.()) {
        reject(new Error("Upload cancelled"));
        return;
      }
      xhr.upload.addEventListener("progress", (event) => {
        if (callbacks.isCancelled?.()) {
          xhr.abort();
          return;
        }
        if (event.lengthComputable) {
          callbacks.onProgress?.((event.loaded / event.total) * 100);
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed with status ${xhr.status}`));
      });
      xhr.addEventListener("error", () => reject(new Error("Upload failed")));
      xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
      xhr.open("PUT", uploadUrl);
      xhr.send(file);
    }),
  );

const uploadNativeVideoSource = async (
  jobId: string,
  uploadUrl: string,
  callbacks: MuxUploadCallbacks,
  setCancelTransport: (cancel: () => Promise<void>) => void,
  startUpload: (api: NonNullable<typeof window.electronAPI>) => Promise<void>,
) => {
  const api = window.electronAPI;
  if (!api?.onVideoDownloadProgress) {
    throw new Error("Native video upload is unavailable on this device.");
  }
  const unsubscribe = api.onVideoDownloadProgress((event) => {
    if (event.jobId === jobId && event.stage === "uploading" && event.progress !== null) {
      callbacks.onProgress?.(event.progress);
    }
  });
  setCancelTransport(async () => {
    await api.cancelVideoDownload(jobId);
  });
  try {
    if (callbacks.isCancelled?.()) throw new Error("Upload cancelled");
    await startUpload(api);
  } finally {
    unsubscribe();
  }
};

export const uploadDownloadedVideoToMux = (
  jobId: string,
  fileName: string,
  options: MuxUploadOptions,
  callbacks: MuxUploadCallbacks = {},
): Promise<MuxUploadResult> =>
  uploadVideoToMuxFromSource(fileName, options, callbacks, async (uploadUrl, setCancelTransport) => {
    await uploadNativeVideoSource(jobId, uploadUrl, callbacks, setCancelTransport, async (api) => {
      if (!api.uploadDownloadedVideoToMux) {
        throw new Error("Native video upload is unavailable on this device.");
      }
      await api.uploadDownloadedVideoToMux(jobId, uploadUrl);
    });
  });

export const uploadLocalVideoAssetToMux = (
  assetId: string,
  fileName: string,
  options: MuxUploadOptions,
  callbacks: MuxUploadCallbacks = {},
): Promise<MuxUploadResult> =>
  uploadVideoToMuxFromSource(fileName, options, callbacks, async (uploadUrl, setCancelTransport) => {
    if (!window.electronAPI?.uploadLocalVideoAssetToMux) {
      throw new Error("Native video upload is unavailable on this device.");
    }
    const jobId = globalThis.crypto.randomUUID();
    await uploadNativeVideoSource(jobId, uploadUrl, callbacks, setCancelTransport, async (api) => {
      if (!api.uploadLocalVideoAssetToMux) {
        throw new Error("Native video upload is unavailable on this device.");
      }
      await api.uploadLocalVideoAssetToMux({ jobId, assetId, url: uploadUrl });
    });
  });
