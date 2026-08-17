import type { LocalVideoFileReference } from "../types";
import {
  encodeLocalAssetThumbnailBlob,
  getLocalImageThumbnail,
  LOCAL_VIDEO_STORE_NAME,
  openLocalAssetDb,
  saveLocalImageThumbnail,
  THUMBNAIL_STORE_NAME,
  type StoredLocalImageThumbnail,
} from "./localImageAssets";

const LOCAL_VIDEO_FILE_URL_PREFIX = "local-video-file://";
const MAX_BROWSER_LOCAL_VIDEO_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const LOCAL_VIDEO_FILE_CHANGE_EVENT = "worshipsync-local-video-file-change";
const VIDEO_THUMBNAIL_TIMEOUT_MS = 8_000;

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

export const validateLocalVideoFile = (file: File): string | null => {
  if (!ALLOWED_VIDEO_TYPES.has(file.type.toLowerCase())) {
    return "Choose an MP4, MOV, or WebM video.";
  }
  if (file.size <= 0) return "Choose a video that is not empty.";
  if (!window.electronAPI && file.size > MAX_BROWSER_LOCAL_VIDEO_BYTES) {
    return "Choose a video smaller than 500 MB in the browser, or use the desktop app for larger files.";
  }
  return null;
};

export const readVideoMetadata = (file: File) =>
  new Promise<{ width: number; height: number; duration: number }>(
    (resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      const cleanup = () => {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      };
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const duration = video.duration;
        cleanup();
        if (
          width > 0 &&
          height > 0 &&
          Number.isFinite(duration) &&
          duration > 0
        ) {
          resolve({ width, height, duration });
          return;
        }
        reject(new Error("The selected video has invalid metadata."));
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("The selected video could not be read."));
      };
      video.src = url;
    },
  );

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
  const objectUrl = typeof source === "string" ? "" : URL.createObjectURL(source);
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
        video.src = objectUrl || source;
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
): Promise<StoredLocalImageThumbnail | undefined> => {
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

export const saveLocalVideoFile = async (video: StoredLocalVideoFile) => {
  const thumbnail = await createLocalVideoFileThumbnail(video).catch(
    () => undefined,
  );
  const useElectronStore =
    Boolean(window.electronAPI?.importLocalAsset) && video.blob instanceof File;
  if (useElectronStore) {
    await window.electronAPI!.importLocalAsset(video.blob as File, {
      assetId: video.id,
      workspaceId: video.workspaceId,
      kind: "video",
      fileName: video.fileName,
      contentType: video.contentType,
      width: video.width,
      height: video.height,
    });
  }
  const storedVideo = useElectronStore ? { ...video, blob: undefined } : video;
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const stores = thumbnail
        ? [LOCAL_VIDEO_STORE_NAME, THUMBNAIL_STORE_NAME]
        : [LOCAL_VIDEO_STORE_NAME];
      const transaction = db.transaction(stores, "readwrite");
      transaction.objectStore(LOCAL_VIDEO_STORE_NAME).put(storedVideo);
      if (thumbnail) {
        transaction.objectStore(THUMBNAIL_STORE_NAME).put(thumbnail);
      }
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

const pendingVideoThumbnailBackfills = new Map<
  string,
  Promise<StoredLocalImageThumbnail | undefined>
>();
let videoThumbnailBackfillQueue: Promise<void> = Promise.resolve();

/**
 * Legacy local videos do not have a still. Generate at most one at a time so a
 * media grid cannot decode every original in parallel.
 */
export const getOrCreateLocalVideoFileThumbnail = async (assetId: string) => {
  const existing = await getLocalImageThumbnail(assetId);
  if (existing) return existing;
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
        const video = await getLocalVideoFile(assetId);
        const thumbnail = video
          ? await createLocalVideoFileThumbnail(video).catch(() => undefined)
          : undefined;
        if (thumbnail) await saveLocalImageThumbnail(thumbnail);
        resolveBackfill?.(thumbnail);
        if (thumbnail) notifyLocalVideoFileChange(assetId);
      } catch {
        resolveBackfill?.(undefined);
      } finally {
        pendingVideoThumbnailBackfills.delete(assetId);
      }
    });
  return backfill;
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
    storagePolicy:
      value.storagePolicy === "local-and-cloud"
        ? "local-and-cloud"
        : "local-only",
  };
};
