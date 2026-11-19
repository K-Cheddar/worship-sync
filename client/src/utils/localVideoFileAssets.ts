import type { LocalVideoFileReference } from "../types";
import {
  encodeLocalAssetThumbnailBlob,
  getLocalAssetThumbnailDimensions,
  getLocalImageThumbnail,
  LOCAL_VIDEO_STORE_NAME,
  openLocalAssetDb,
  saveLocalVideoThumbnail,
  THUMBNAIL_STORE_NAME,
  type StoredLocalImageThumbnail,
} from "./localImageAssets";
import {
  getVideoContentType,
  isSupportedVideoFile,
} from "./mediaFileTypes";
import { assignPlayableVideoSource } from "./mediaSource";

const LOCAL_VIDEO_FILE_URL_PREFIX = "local-video-file://";
const MAX_BROWSER_LOCAL_VIDEO_BYTES = 500 * 1024 * 1024;
const LOCAL_VIDEO_FILE_CHANGE_EVENT = "worshipsync-local-video-file-change";
const VIDEO_METADATA_TIMEOUT_MS = 10_000;
const VIDEO_THUMBNAIL_TIMEOUT_MS = 8_000;
const VIDEO_THUMBNAIL_SEEK_TIMEOUT_MS = 1_500;
const VIDEO_THUMBNAIL_GENERATOR_VERSION = 2;
const VIDEO_THUMBNAIL_FAILURE_RETRY_MS = 60_000;
const MAX_SOURCE_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_THUMBNAIL_PIXELS = 40_000_000;

type VideoThumbnailFailureStage =
  | "source-unavailable"
  | "unsupported-decoder"
  | "metadata-load"
  | "seek-timeout"
  | "canvas-capture"
  | "canvas-encoding"
  | "thumbnail-persistence";

class LocalVideoThumbnailError extends Error {
  stage: VideoThumbnailFailureStage;

  constructor(stage: VideoThumbnailFailureStage, message: string) {
    super(message);
    this.name = "LocalVideoThumbnailError";
    this.stage = stage;
  }
}

export type StoredLocalVideoFile = {
  contentHash?: string;
  contentRevision?: string;
  id: string;
  workspaceId?: string;
  blob?: Blob;
  fileName: string;
  contentType: string;
  size: number;
  width: number;
  height: number;
  duration: number;
  createdAt: string;
};

const getVideoContentRevision = (video: StoredLocalVideoFile) =>
  video.contentHash ||
  video.contentRevision ||
  `${video.createdAt}:${video.size}`;

const videoThumbnailFailures = new Map<string, number>();
const reportedVideoThumbnailFailures = new Set<string>();

const thumbnailQueueKey = (assetId: string, contentRevision: string) =>
  `${assetId}:${contentRevision}`;

const reportVideoThumbnailFailure = (
  assetId: string,
  stage: VideoThumbnailFailureStage,
  error: unknown,
) => {
  if (!import.meta.env.DEV) return;
  const reportKey = `${assetId}:${stage}`;
  if (reportedVideoThumbnailFailures.has(reportKey)) return;
  reportedVideoThumbnailFailures.add(reportKey);
  console.warn(`[local-video-thumbnail] ${stage}`, {
    assetId,
    message: error instanceof Error ? error.message : String(error),
  });
};

export const buildLocalVideoFileUrl = (assetId: string) =>
  `${LOCAL_VIDEO_FILE_URL_PREFIX}${encodeURIComponent(assetId)}`;

export const isLocalVideoFileUrl = (value: string | undefined) =>
  Boolean(value?.startsWith(LOCAL_VIDEO_FILE_URL_PREFIX));

export const parseLocalVideoFileAssetId = (value: string | undefined) => {
  if (!isLocalVideoFileUrl(value) || !value) return null;
  try {
    return decodeURIComponent(value.slice(LOCAL_VIDEO_FILE_URL_PREFIX.length));
  } catch {
    return value.slice(LOCAL_VIDEO_FILE_URL_PREFIX.length) || null;
  }
};

export const validateLocalVideoFile = (file: File): string | null => {
  if (!isSupportedVideoFile(file)) {
    return "Choose a supported video file, such as MP4, MOV, WebM, MKV, or AVI.";
  }
  if (file.size <= 0) return "Choose a video that is not empty.";
  if (!window.electronAPI && file.size > MAX_BROWSER_LOCAL_VIDEO_BYTES) {
    return "Choose a video smaller than 500 MB in the browser, or use the desktop app for larger files.";
  }
  return null;
};

export const getLocalVideoContentType = (file: File) =>
  getVideoContentType(file);

const readVideoMetadataFromUrl = (source: string, revokeSource?: () => void) =>
  new Promise<{ width: number; height: number; duration: number }>(
    (resolve, reject) => {
      const video = document.createElement("video");
      let settled = false;
      const cleanup = () => {
        video.removeAttribute("src");
        video.load();
        revokeSource?.();
      };
      let timeoutId = 0;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        video.onloadeddata = null;
        video.onerror = null;
        cleanup();
        if (error) {
          reject(error);
        }
      };
      timeoutId = window.setTimeout(() => {
        finish(new Error("The selected video could not be read in time."));
      }, VIDEO_METADATA_TIMEOUT_MS);
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.onloadeddata = () => {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const duration = video.duration;
        if (
          width > 0 &&
          height > 0 &&
          Number.isFinite(duration) &&
          duration > 0
        ) {
          finish();
          resolve({ width, height, duration });
          return;
        }
        finish(new Error("The selected video has invalid metadata."));
      };
      video.onerror = () => {
        finish(new Error("The selected video could not be read."));
      };
      if (!assignPlayableVideoSource(video, source, { path: "local-video-metadata" })) {
        finish(new Error("The selected video could not be read."));
      }
    },
  );

export const readVideoMetadata = (file: File) => {
  const url = URL.createObjectURL(file);
  return readVideoMetadataFromUrl(url, () => URL.revokeObjectURL(url));
};

export const readVideoMetadataFromLocalAsset = (url: string) =>
  readVideoMetadataFromUrl(url);

const waitForVideoEvent = (
  video: HTMLVideoElement,
  eventName: "loadeddata" | "seeked",
  timeoutMs: number,
  timeoutStage: VideoThumbnailFailureStage,
) =>
  (() => {
    if (
      eventName === "loadeddata" &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return { promise: Promise.resolve(), cancel: () => undefined };
    }
    let settled = false;
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    let timeoutId = 0;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener("error", onError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const onSuccess = () => finish();
    const onError = () => {
      const mediaError = video.error;
      const stage =
        mediaError?.code === 3 || mediaError?.code === 4
          ? "unsupported-decoder"
          : mediaError?.code === 2
            ? "source-unavailable"
            : timeoutStage === "seek-timeout"
              ? "seek-timeout"
              : "metadata-load";
      finish(
        new LocalVideoThumbnailError(
          stage,
          mediaError?.message || "The video frame could not be decoded.",
        ),
      );
    };
    video.addEventListener(eventName, onSuccess);
    video.addEventListener("error", onError);
    timeoutId = window.setTimeout(
      () =>
        finish(
          new LocalVideoThumbnailError(
            timeoutStage,
            eventName === "seeked"
              ? "The video frame seek timed out."
              : "The video frame did not finish loading in time.",
          ),
        ),
      timeoutMs,
    );
    return { promise, cancel: () => finish() };
  })();

export const getVideoThumbnailSeekTimes = (duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const lastSafeTime = Math.max(0, duration - 0.01);
  return Array.from(
    new Set(
      [0.1, 0.25, 0.5].map((fraction) => {
        const sampleTime = Math.round(duration * fraction * 1_000) / 1_000;
        return Math.min(sampleTime, lastSafeTime);
      }),
    ),
  );
};

const getFrameScore = (pixels: Uint8ClampedArray) => {
  let luminanceTotal = 0;
  let visiblePixelCount = 0;
  let minLuminance = 255;
  let maxLuminance = 0;
  const pixelCount = Math.floor(pixels.length / 4);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const luminance =
      pixels[index] * 0.2126 +
      pixels[index + 1] * 0.7152 +
      pixels[index + 2] * 0.0722;
    luminanceTotal += luminance;
    minLuminance = Math.min(minLuminance, luminance);
    maxLuminance = Math.max(maxLuminance, luminance);
    if (luminance > 12) visiblePixelCount += 1;
  }
  if (visiblePixelCount === 0 || pixelCount === 0) return -1;
  const averageLuminance = luminanceTotal / pixelCount;
  const visibleRatio = visiblePixelCount / pixelCount;
  const contrast = (maxLuminance - minLuminance) / 255;
  return averageLuminance / 255 + visibleRatio * 0.5 + contrast * 0.25;
};

const createThumbnailCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new LocalVideoThumbnailError(
      "canvas-capture",
      "The video frame could not be drawn to a canvas.",
    );
  }
  return { canvas, context };
};

const captureVideoThumbnailFromSource = async ({
  id,
  createdAt,
  width,
  height,
  duration,
  contentRevision,
  source,
}: {
  id: string;
  createdAt: string;
  width: number;
  height: number;
  duration: number;
  contentRevision: string;
  source: Blob | string;
}): Promise<StoredLocalImageThumbnail | undefined> => {
  if (typeof document === "undefined" || width <= 0 || height <= 0) {
    throw new LocalVideoThumbnailError(
      "metadata-load",
      "The video dimensions are unavailable.",
    );
  }
  let objectUrl = "";
  try {
    objectUrl = typeof source === "string" ? "" : URL.createObjectURL(source);
  } catch (error) {
    throw new LocalVideoThumbnailError(
      "source-unavailable",
      error instanceof Error ? error.message : "The video source is unavailable.",
    );
  }
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // Electron serves managed files from the custom worshipsync-media origin.
  // Request CORS access so canvas pixel scoring can inspect decoded frames.
  video.crossOrigin = "anonymous";
  let pendingWait: ReturnType<typeof waitForVideoEvent> | undefined;
  try {
    pendingWait = waitForVideoEvent(
      video,
      "loadeddata",
      VIDEO_THUMBNAIL_TIMEOUT_MS,
      "metadata-load",
    );
    const playbackSource = typeof source === "string" ? source : objectUrl;
    if (
      !playbackSource ||
      !assignPlayableVideoSource(video, playbackSource, {
        path: "local-video-thumbnail",
      })
    ) {
      throw new LocalVideoThumbnailError(
        "source-unavailable",
        "The video source is unavailable.",
      );
    }
    await pendingWait.promise;
    pendingWait = undefined;
    if (video.error) {
      const stage = video.error.code === 3 || video.error.code === 4
        ? "unsupported-decoder"
        : "source-unavailable";
      throw new LocalVideoThumbnailError(
        stage,
        video.error.message || "The video frame could not be decoded.",
      );
    }
    const sourceWidth = video.videoWidth || width;
    const sourceHeight = video.videoHeight || height;
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new LocalVideoThumbnailError(
        "metadata-load",
        "The decoded video dimensions are unavailable.",
      );
    }
    const thumbnailSize = getLocalAssetThumbnailDimensions(
      sourceWidth,
      sourceHeight,
    );
    let best: ReturnType<typeof createThumbnailCanvas>;
    let sample: ReturnType<typeof createThumbnailCanvas>;
    let bestScore = -Infinity;
    try {
      best = createThumbnailCanvas(thumbnailSize.width, thumbnailSize.height);
      sample = createThumbnailCanvas(thumbnailSize.width, thumbnailSize.height);
      best.context.drawImage(video, 0, 0, thumbnailSize.width, thumbnailSize.height);
      bestScore = getFrameScore(
        best.context.getImageData(
          0,
          0,
          thumbnailSize.width,
          thumbnailSize.height,
        ).data,
      );
    } catch (error) {
      if (error instanceof LocalVideoThumbnailError) throw error;
      throw new LocalVideoThumbnailError(
        "canvas-capture",
        error instanceof Error ? error.message : "The video frame could not be captured.",
      );
    }

    const seekTimes = getVideoThumbnailSeekTimes(
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : duration,
    );
    for (const seekTime of seekTimes) {
      try {
        if (seekTime > 0) {
          pendingWait = waitForVideoEvent(
            video,
            "seeked",
            VIDEO_THUMBNAIL_SEEK_TIMEOUT_MS,
            "seek-timeout",
          );
          video.currentTime = seekTime;
          await pendingWait.promise;
          pendingWait = undefined;
        }
      } catch (error) {
        pendingWait = undefined;
        reportVideoThumbnailFailure(
          id,
          error instanceof LocalVideoThumbnailError
            ? error.stage
            : "seek-timeout",
          error,
        );
        continue;
      }

      try {
        sample.context.drawImage(
          video,
          0,
          0,
          thumbnailSize.width,
          thumbnailSize.height,
        );
        const pixels = sample.context.getImageData(
          0,
          0,
          thumbnailSize.width,
          thumbnailSize.height,
        );
        const score = getFrameScore(pixels.data);
        if (score > bestScore) {
          best.context.drawImage(
            sample.canvas,
            0,
            0,
            thumbnailSize.width,
            thumbnailSize.height,
          );
          bestScore = score;
        }
      } catch (error) {
        throw new LocalVideoThumbnailError(
          "canvas-capture",
          error instanceof Error ? error.message : "The video frame could not be analyzed.",
        );
      }
    }

    let encodeFailure: unknown;
    const encoded = await encodeLocalAssetThumbnailBlob(
      best.canvas,
      thumbnailSize.width,
      thumbnailSize.height,
    ).catch((error: unknown) => {
      encodeFailure = error;
      return undefined;
    });
    if (!encoded) {
      throw new LocalVideoThumbnailError(
        "canvas-encoding",
        encodeFailure instanceof Error
          ? encodeFailure.message
          : "The video thumbnail could not be encoded as WebP.",
      );
    }
    return {
      id,
      createdAt,
      ...encoded,
      videoThumbnail: {
        source: "generated",
        contentRevision,
        generatorVersion: VIDEO_THUMBNAIL_GENERATOR_VERSION,
      },
    };
  } finally {
    pendingWait?.cancel();
    try {
      video.removeAttribute("src");
      video.load();
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
};

export const createLocalVideoFileThumbnail = async (
  video: StoredLocalVideoFile,
  preferredThumbnail?: Blob,
): Promise<StoredLocalImageThumbnail | undefined> => {
  const contentRevision = getVideoContentRevision(video);
  if (
    preferredThumbnail &&
    preferredThumbnail.size > 0 &&
    preferredThumbnail.size <= MAX_SOURCE_THUMBNAIL_BYTES &&
    /^image\/(?:jpeg|png|webp)$/i.test(preferredThumbnail.type) &&
    typeof createImageBitmap === "function"
  ) {
    try {
      const bitmap = await createImageBitmap(preferredThumbnail);
      try {
        if (
          bitmap.width > 0 && bitmap.height > 0 &&
          bitmap.width * bitmap.height <= MAX_SOURCE_THUMBNAIL_PIXELS
        ) {
          const encoded = await encodeLocalAssetThumbnailBlob(
            bitmap,
            bitmap.width,
            bitmap.height,
          );
          if (encoded) {
            return {
              id: video.id,
              createdAt: video.createdAt,
              ...encoded,
              videoThumbnail: {
                source: "supplied",
                contentRevision,
              },
            };
          }
        }
      } finally {
        bitmap.close();
      }
    } catch {
      // A malformed or unsupported source image falls back to a video frame.
    }
  }
  if (video.blob) {
    return captureVideoThumbnailFromSource({
      id: video.id,
      createdAt: video.createdAt,
      width: video.width,
      height: video.height,
      duration: video.duration,
      contentRevision,
      source: video.blob,
    });
  }
  const getLocalAsset = window.electronAPI?.getLocalAsset;
  if (!getLocalAsset) {
    throw new LocalVideoThumbnailError(
      "source-unavailable",
      "The local video source is unavailable on this device.",
    );
  }
  let asset: Awaited<ReturnType<typeof getLocalAsset>>;
  try {
    asset = await getLocalAsset(video.id);
  } catch (error) {
    throw new LocalVideoThumbnailError(
      "source-unavailable",
      error instanceof Error ? error.message : "The local video source is unavailable.",
    );
  }
  if (!asset?.url) {
    throw new LocalVideoThumbnailError(
      "source-unavailable",
      "The local video source is unavailable on this device.",
    );
  }
  return captureVideoThumbnailFromSource({
    id: video.id,
    createdAt: video.createdAt,
    width: video.width,
    height: video.height,
    duration: video.duration,
    contentRevision,
    source: asset.url,
  });
};

const notifyLocalVideoFileChange = (assetId: string) => {
  for (const key of videoThumbnailFailures.keys()) {
    if (key.startsWith(`${assetId}:`)) videoThumbnailFailures.delete(key);
  }
  window.dispatchEvent(
    new CustomEvent(LOCAL_VIDEO_FILE_CHANGE_EVENT, { detail: { assetId } }),
  );
};
let nativeChangeSubscription: (() => void) | undefined;

export const subscribeLocalVideoFileChanges = (
  listener: (assetId: string) => void,
) => {
  // One app-lifetime native bridge fans out through the existing renderer event.
  // Output windows must invalidate the same committed source as the controller.
  if (!nativeChangeSubscription && window.electronAPI?.onLocalVideoAssetChanged) {
    nativeChangeSubscription = window.electronAPI.onLocalVideoAssetChanged(notifyLocalVideoFileChange);
  }
  const onChange = (event: Event) => {
    const assetId = (event as CustomEvent<{ assetId?: unknown }>).detail
      ?.assetId;
    if (typeof assetId === "string" && assetId) listener(assetId);
  };
  window.addEventListener(LOCAL_VIDEO_FILE_CHANGE_EVENT, onChange);
  return () =>
    window.removeEventListener(LOCAL_VIDEO_FILE_CHANGE_EVENT, onChange);
};

export const saveLocalVideoFile = async (
  video: StoredLocalVideoFile,
  options: { importBytes?: boolean; thumbnailBlob?: Blob; deferThumbnail?: boolean; invalidateThumbnail?: boolean } = {},
) => {
  const file = video.blob;
  const shouldImportBytes =
    options.importBytes && Boolean(window.electronAPI?.importLocalAssetBytes);
  const shouldImportFromPath =
    !options.importBytes && Boolean(window.electronAPI?.importLocalAsset);
  const useElectronStore =
    file instanceof File &&
    (shouldImportBytes || shouldImportFromPath);
  if (useElectronStore) {
    const metadata = {
      assetId: video.id,
      workspaceId: video.workspaceId,
      kind: "video" as const,
      fileName: video.fileName,
      contentType: video.contentType,
      width: video.width,
      height: video.height,
    };
    if (shouldImportBytes) {
      await window.electronAPI!.importLocalAssetBytes(
        await file.arrayBuffer(),
        metadata,
      );
    } else {
      await window.electronAPI!.importLocalAsset(file, metadata);
    }
  }
  const contentRevision = getVideoContentRevision(video);
  const storedVideo = {
    ...video,
    contentRevision,
    ...(useElectronStore ? { blob: undefined } : {}),
  };
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        [LOCAL_VIDEO_STORE_NAME, THUMBNAIL_STORE_NAME],
        "readwrite",
      );
      const videoStore = transaction.objectStore(LOCAL_VIDEO_STORE_NAME);
      const currentVideoRequest = videoStore.get(video.id);
      currentVideoRequest.onsuccess = () => {
        const currentVideo = currentVideoRequest.result as
          | StoredLocalVideoFile
          | undefined;
        const currentRevision = currentVideo
          ? getVideoContentRevision(currentVideo)
          : undefined;
        if (
          options.invalidateThumbnail ||
          (currentRevision && currentRevision !== contentRevision)
        ) {
          transaction.objectStore(THUMBNAIL_STORE_NAME).delete(video.id);
        }
        videoStore.put(storedVideo);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The video could not be saved locally."),
        );
      transaction.onabort = transaction.onerror;
    });
    try {
      await navigator.storage?.persist?.();
    } catch {
      // Best effort. IndexedDB remains the browser fallback without it.
    }
  } finally {
    db.close();
  }
  if (options.deferThumbnail || options.thumbnailBlob) {
    void queueLocalVideoThumbnail(video.id, () =>
      createLocalVideoFileThumbnail(video, options.thumbnailBlob),
      video.contentHash,
      contentRevision,
      Boolean(options.thumbnailBlob),
    );
  }
  notifyLocalVideoFileChange(video.id);
};

export const getLocalVideoFile = async (
  assetId: string,
): Promise<StoredLocalVideoFile | undefined> => {
  const db = await openLocalAssetDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(LOCAL_VIDEO_STORE_NAME, "readonly");
      const request = transaction
        .objectStore(LOCAL_VIDEO_STORE_NAME)
        .get(assetId);
      request.onsuccess = () =>
        resolve(request.result as StoredLocalVideoFile | undefined);
      request.onerror = () =>
        reject(
          request.error ?? new Error("The local video could not be read."),
        );
    });
  } finally {
    db.close();
  }
};

export type LocalVideoFileBlob = {
  blob: Blob;
  fileName: string;
  contentType: string;
};

/** Bytes for an owner-side cloud upload: IndexedDB in the browser, disk in Electron. */
export const getLocalVideoFileBlob = async (
  assetId: string,
): Promise<LocalVideoFileBlob | undefined> => {
  const stored = await getLocalVideoFile(assetId);
  if (stored?.blob && stored.blob.size > 0) {
    return {
      blob: stored.blob,
      fileName: stored.fileName,
      contentType: stored.contentType || stored.blob.type,
    };
  }
  if (!window.electronAPI?.getLocalAsset) return undefined;
  const asset = await window.electronAPI.getLocalAsset(assetId);
  if (!asset?.url) return undefined;
  const response = await fetch(asset.url);
  if (!response.ok) return undefined;
  const blob = await response.blob();
  if (blob.size <= 0) return undefined;
  return {
    blob,
    fileName: asset.fileName || stored?.fileName || "video",
    contentType: asset.contentType || blob.type,
  };
};

export const deleteLocalVideoFile = async (assetId: string) => {
  if (window.electronAPI?.deleteLocalAsset) {
    await window.electronAPI.deleteLocalAsset(assetId);
  }
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        [LOCAL_VIDEO_STORE_NAME, THUMBNAIL_STORE_NAME],
        "readwrite",
      );
      transaction.objectStore(LOCAL_VIDEO_STORE_NAME).delete(assetId);
      transaction.objectStore(THUMBNAIL_STORE_NAME).delete(assetId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The local video could not be removed."),
        );
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  notifyLocalVideoFileChange(assetId);
};

export const deleteLocalVideoThumbnail = async (assetId: string) => {
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(THUMBNAIL_STORE_NAME, "readwrite");
      transaction.objectStore(THUMBNAIL_STORE_NAME).delete(assetId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("The video thumbnail could not be refreshed."));
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  notifyLocalVideoFileChange(assetId);
};

const pendingVideoThumbnailBackfills = new Map<
  string,
  Promise<StoredLocalImageThumbnail | undefined>
>();
let videoThumbnailBackfillQueue: Promise<void> = Promise.resolve();

const isReusableVideoThumbnail = (
  thumbnail: StoredLocalImageThumbnail | undefined,
  video: StoredLocalVideoFile,
  preferSuppliedThumbnail = false,
) => {
  if (
    !thumbnail?.blob ||
    thumbnail.blob.size <= 0 ||
    thumbnail.width <= 0 ||
    thumbnail.height <= 0
  ) {
    return false;
  }
  const provenance = thumbnail.videoThumbnail;
  // Older records do not distinguish a generated still from a supplied poster.
  // Keep those records intact rather than guessing and overwriting a poster.
  if (!provenance) return true;
  if (provenance.contentRevision !== getVideoContentRevision(video)) return false;
  if (provenance.source === "supplied") return true;
  return (
    !preferSuppliedThumbnail &&
    provenance.generatorVersion === VIDEO_THUMBNAIL_GENERATOR_VERSION
  );
};

export const getLocalVideoFileThumbnail = async (assetId: string) => {
  const [video, thumbnail] = await Promise.all([
    getLocalVideoFile(assetId),
    getLocalImageThumbnail(assetId),
  ]);
  if (!video) return undefined;
  return isReusableVideoThumbnail(thumbnail, video) ? thumbnail : undefined;
};

const queueLocalVideoThumbnail = (
  assetId: string,
  createThumbnail: () => Promise<StoredLocalImageThumbnail | undefined>,
  expectedContentHash?: string,
  expectedContentRevision?: string,
  preferSuppliedThumbnail = false,
) => {
  const revision = expectedContentRevision ?? expectedContentHash ?? "legacy";
  const queueKey = thumbnailQueueKey(assetId, revision);
  const pending = pendingVideoThumbnailBackfills.get(queueKey);
  if (pending) return pending;
  if ((videoThumbnailFailures.get(queueKey) ?? 0) > Date.now()) {
    return Promise.resolve(undefined);
  }

  let resolveBackfill:
    | ((value: StoredLocalImageThumbnail | undefined) => void)
    | undefined;
  const backfill = new Promise<StoredLocalImageThumbnail | undefined>(
    (resolve) => {
      resolveBackfill = resolve;
    },
  );
  pendingVideoThumbnailBackfills.set(queueKey, backfill);
  videoThumbnailBackfillQueue = videoThumbnailBackfillQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const video = await getLocalVideoFile(assetId);
        if (
          !video ||
          video.contentHash !== expectedContentHash ||
          getVideoContentRevision(video) !== revision
        ) {
          resolveBackfill?.(undefined);
          return;
        }
        const current = await getLocalImageThumbnail(assetId);
        if (
          isReusableVideoThumbnail(
            current,
            video,
            preferSuppliedThumbnail,
          )
        ) {
          resolveBackfill?.(current);
          return;
        }
        let thumbnail: StoredLocalImageThumbnail | undefined;
        try {
          thumbnail = await createThumbnail();
        } catch (error) {
          const stage = error instanceof LocalVideoThumbnailError
            ? error.stage
            : "unsupported-decoder";
          reportVideoThumbnailFailure(assetId, stage, error);
        }
        if (!thumbnail) {
          videoThumbnailFailures.set(
            queueKey,
            Date.now() + VIDEO_THUMBNAIL_FAILURE_RETRY_MS,
          );
          resolveBackfill?.(undefined);
          return;
        }
        const latest = await getLocalImageThumbnail(assetId);
        const canReplaceExisting = Boolean(
          latest?.videoThumbnail &&
            (latest.videoThumbnail.contentRevision !== revision ||
              (latest.videoThumbnail.source === "generated" &&
                (latest.videoThumbnail.generatorVersion !==
                  VIDEO_THUMBNAIL_GENERATOR_VERSION ||
                  thumbnail.videoThumbnail?.source === "supplied"))),
        );
        const saved = await saveLocalVideoThumbnail(
          thumbnail,
          expectedContentHash,
          revision,
          canReplaceExisting,
        );
        if (saved) {
          resolveBackfill?.(thumbnail);
          videoThumbnailFailures.delete(queueKey);
          notifyLocalVideoFileChange(assetId);
          if (expectedContentHash) {
            // Only the controller is authorized to fan this out natively.
            // Output-side thumbnail generation remains a local cache write.
            void window.electronAPI?.notifyLocalVideoAssetChanged?.(assetId, expectedContentHash).catch(() => undefined);
          }
        } else {
          const currentAfterSave = await getLocalImageThumbnail(assetId);
          resolveBackfill?.(
            isReusableVideoThumbnail(currentAfterSave, video)
              ? currentAfterSave
              : undefined,
          );
        }
      } catch (error) {
        reportVideoThumbnailFailure(
          assetId,
          error instanceof LocalVideoThumbnailError
            ? error.stage
            : "thumbnail-persistence",
          error,
        );
        videoThumbnailFailures.set(
          queueKey,
          Date.now() + VIDEO_THUMBNAIL_FAILURE_RETRY_MS,
        );
        resolveBackfill?.(undefined);
      } finally {
        if (pendingVideoThumbnailBackfills.get(queueKey) === backfill) {
          pendingVideoThumbnailBackfills.delete(queueKey);
        }
      }
    });
  return backfill;
};

/**
 * Legacy local videos do not have a still. Generate at most one at a time so a
 * media grid cannot decode every original in parallel.
 */
export const getOrCreateLocalVideoFileThumbnail = async (assetId: string) => {
  let video: StoredLocalVideoFile | undefined;
  let existing: StoredLocalImageThumbnail | undefined;
  try {
    [video, existing] = await Promise.all([
      getLocalVideoFile(assetId),
      getLocalImageThumbnail(assetId),
    ]);
  } catch (error) {
    reportVideoThumbnailFailure(assetId, "thumbnail-persistence", error);
    return undefined;
  }
  if (!video) return undefined;
  if (isReusableVideoThumbnail(existing, video)) return existing;
  const contentRevision = getVideoContentRevision(video);
  return queueLocalVideoThumbnail(
    assetId,
    () => createLocalVideoFileThumbnail(video!),
    video.contentHash,
    contentRevision,
  );
};

export const normalizeLocalVideoFileReference = (
  value: LocalVideoFileReference | undefined,
): LocalVideoFileReference | undefined => {
  if (!value?.id || !value.ownerDeviceId) return undefined;
  return {
    ...value,
    fileName: value.fileName?.trim() || "Local video",
    contentType: value.contentType?.trim() || "video/mp4",
    ownerLabel: value.ownerLabel?.trim() || "source device",
    storageMode: value.storageMode === "linked" ? "linked" : "managed",
    ...(typeof value.contentHash === "string" && /^[a-f0-9]{64}$/i.test(value.contentHash)
      ? { contentHash: value.contentHash.toLowerCase() }
      : { contentHash: undefined }),
    storagePolicy:
      value.storagePolicy === "local-and-cloud"
        ? "local-and-cloud"
        : "local-only",
  };
};
