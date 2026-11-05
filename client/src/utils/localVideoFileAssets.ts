import type { LocalVideoFileReference } from "../types";
import {
  encodeLocalAssetThumbnailBlob,
  getLocalImageThumbnail,
  LOCAL_VIDEO_STORE_NAME,
  openLocalAssetDb,
  saveLocalImageThumbnail,
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
const MAX_SOURCE_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_THUMBNAIL_PIXELS = 40_000_000;

export type StoredLocalVideoFile = {
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
) =>
  new Promise<void>((resolve, reject) => {
    if (
      eventName === "loadeddata" &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      resolve();
      return;
    }
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The selected video could not be read."));
    };
    const cleanup = () => {
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(eventName, onSuccess);
    video.addEventListener("error", onError);
  });

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("The video thumbnail could not be created in time."));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });

const getVideoThumbnailSeekTime = (duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, duration * 0.1));
};

const captureVideoThumbnailFromSource = async ({
  id,
  createdAt,
  width,
  height,
  duration,
  source,
}: {
  id: string;
  createdAt: string;
  width: number;
  height: number;
  duration: number;
  source: Blob | string;
}): Promise<StoredLocalImageThumbnail | undefined> => {
  if (typeof document === "undefined" || width <= 0 || height <= 0) {
    return undefined;
  }
  const objectUrl =
    typeof source === "string" ? "" : URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const playableType =
    typeof source === "string" ? "video/mp4" : source.type || "video/mp4";
  if (!video.canPlayType?.(playableType)) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return undefined;
  }
  try {
    return await withTimeout(
      (async () => {
        const loaded = waitForVideoEvent(video, "loadeddata");
        const playbackSource = typeof source === "string" ? source : objectUrl;
        if (!playbackSource || !assignPlayableVideoSource(video, playbackSource, { path: "local-video-thumbnail" })) {
          throw new Error("The selected video could not be read.");
        }
        if (video.error) {
          throw new Error("The selected video could not be read.");
        }
        await loaded;
        const seekTo = getVideoThumbnailSeekTime(
          Number.isFinite(video.duration) && video.duration > 0
            ? video.duration
            : duration,
        );
        if (seekTo > 0) {
          const seeked = waitForVideoEvent(video, "seeked");
          video.currentTime = seekTo;
          await seeked;
        }
        const sourceWidth = video.videoWidth || width;
        const sourceHeight = video.videoHeight || height;
        const encoded = await encodeLocalAssetThumbnailBlob(
          video,
          sourceWidth,
          sourceHeight,
        );
        if (!encoded) return undefined;
        return { id, createdAt, ...encoded };
      })(),
      VIDEO_THUMBNAIL_TIMEOUT_MS,
    );
  } finally {
    video.removeAttribute("src");
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
};

export const createLocalVideoFileThumbnail = async (
  video: StoredLocalVideoFile,
  preferredThumbnail?: Blob,
): Promise<StoredLocalImageThumbnail | undefined> => {
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
          if (encoded) return { id: video.id, createdAt: video.createdAt, ...encoded };
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
      source: video.blob,
    });
  }
  if (!window.electronAPI?.getLocalAsset) return undefined;
  const asset = await window.electronAPI.getLocalAsset(video.id);
  if (!asset?.url) return undefined;
  return captureVideoThumbnailFromSource({
    id: video.id,
    createdAt: video.createdAt,
    width: video.width,
    height: video.height,
    duration: video.duration,
    source: asset.url,
  });
};

const notifyLocalVideoFileChange = (assetId: string) => {
  window.dispatchEvent(
    new CustomEvent(LOCAL_VIDEO_FILE_CHANGE_EVENT, { detail: { assetId } }),
  );
};

export const subscribeLocalVideoFileChanges = (
  listener: (assetId: string) => void,
) => {
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
  options: { importBytes?: boolean; thumbnailBlob?: Blob; deferThumbnail?: boolean } = {},
) => {
  const thumbnail = options.deferThumbnail
    ? undefined
    : await createLocalVideoFileThumbnail(video, options.thumbnailBlob).catch(
        () => undefined,
      );
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
  const storedVideo = useElectronStore ? { ...video, blob: undefined } : video;
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(LOCAL_VIDEO_STORE_NAME, "readwrite");
      transaction.objectStore(LOCAL_VIDEO_STORE_NAME).put(storedVideo);
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
  if (options.deferThumbnail) {
    void queueLocalVideoThumbnail(video.id, () =>
      createLocalVideoFileThumbnail(video, options.thumbnailBlob),
    );
  } else if (thumbnail) {
    await saveLocalImageThumbnail(thumbnail).catch(() => undefined);
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

const queueLocalVideoThumbnail = (
  assetId: string,
  createThumbnail: () => Promise<StoredLocalImageThumbnail | undefined>,
) => {
  const pending = pendingVideoThumbnailBackfills.get(assetId);
  if (pending) return pending;

  let resolveBackfill:
    | ((value: StoredLocalImageThumbnail | undefined) => void)
    | undefined;
  const backfill = new Promise<StoredLocalImageThumbnail | undefined>(
    (resolve) => {
      resolveBackfill = resolve;
    },
  );
  pendingVideoThumbnailBackfills.set(assetId, backfill);
  videoThumbnailBackfillQueue = videoThumbnailBackfillQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const current = await getLocalImageThumbnail(assetId);
        if (current) {
          resolveBackfill?.(current);
          return;
        }
        const thumbnail = await createThumbnail().catch(() => undefined);
        const saved = thumbnail
          ? await saveLocalVideoThumbnail(thumbnail)
          : false;
        resolveBackfill?.(saved ? thumbnail : undefined);
        if (saved) notifyLocalVideoFileChange(assetId);
      } catch {
        resolveBackfill?.(undefined);
      } finally {
        if (pendingVideoThumbnailBackfills.get(assetId) === backfill) {
          pendingVideoThumbnailBackfills.delete(assetId);
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
  const existing = await getLocalImageThumbnail(assetId);
  if (existing) return existing;
  return queueLocalVideoThumbnail(assetId, async () => {
    const video = await getLocalVideoFile(assetId);
    return video ? createLocalVideoFileThumbnail(video) : undefined;
  });
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
