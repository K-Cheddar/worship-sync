import type {
  LocalAssetStoragePolicy,
  LocalImageAssetReference,
  ItemSlideType,
  Arrangment,
  DBItem,
  DBMedia,
  MediaType,
} from "../types";
import { applyPouchAudit } from "./pouchAudit";
import { isLocalImageUploadJobRunnable } from "./localImageUploadScheduling";

const DB_NAME = "worshipsync-local-assets";
const DB_VERSION = 4;
const STORE_NAME = "images";
export const LOCAL_VIDEO_STORE_NAME = "videos";
export const THUMBNAIL_STORE_NAME = "imageThumbnails";
const UPLOAD_JOB_STORE_NAME = "uploadJobs";
const WORKSPACE_INDEX_NAME = "workspaceId";
const POLICY_KEY_PREFIX = "worshipsync_local_image_policy_v1";
const LOCAL_IMAGE_URL_PREFIX = "local-image://";
const MAX_LOCAL_IMAGE_BYTES = 25 * 1024 * 1024;
const THUMBNAIL_MAX_WIDTH = 160;
const THUMBNAIL_MAX_HEIGHT = 90;
const THUMBNAIL_QUALITY = 0.78;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const normalizeCloudinaryUrl = (value: string) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
};

export type StoredLocalImage = {
  id: string;
  /** Added in v2. Legacy records without it are retained and never swept automatically. */
  workspaceId?: string;
  blob: Blob;
  fileName: string;
  contentType: string;
  size: number;
  width: number;
  height: number;
  createdAt: string;
};

export type StoredLocalImageThumbnail = {
  id: string;
  /** Browser storage keeps the original. Electron stores only this record. */
  blob?: Blob;
  width: number;
  height: number;
  createdAt: string;
};

export type LocalImageUploadJobStatus =
  | "pending"
  | "uploading"
  | "failed"
  | "uploaded";

export type LocalImageUploadJob = {
  id: string;
  assetId: string;
  itemId: string;
  workspaceId: string;
  uploadPreset: string;
  mediaId: string;
  status: LocalImageUploadJobStatus;
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: string;
  cloudMedia?: MediaType;
  /** Cross-tab owner of the current processing attempt. */
  leaseOwnerId?: string;
  /** Epoch milliseconds after which another tab may recover this job. */
  leaseExpiresAt?: number;
  createdAt: string;
  updatedAt: string;
};

export type LocalImageReferencePatch = {
  reference?: Partial<
    Pick<
      LocalImageAssetReference,
      | "ownerDeviceId"
      | "ownerLabel"
      | "contentRevision"
      | "fileName"
      | "contentType"
      | "storagePolicy"
      | "cloudUrl"
      | "cloudMediaId"
    >
  >;
  media?: Partial<Pick<MediaType, "name" | "format" | "width" | "height">>;
};

const LOCAL_IMAGE_CHANGE_EVENT = "worshipsync-local-image-change";
const LOCAL_IMAGE_THUMBNAIL_CHANGE_EVENT =
  "worshipsync-local-image-thumbnail-change";
const LOCAL_IMAGE_UPLOAD_JOB_CHANGE_EVENT =
  "worshipsync-local-image-upload-job-change";
const LOCAL_IMAGE_BROADCAST_CHANNEL = "worshipsync-local-image-assets-v1";
let localImageBroadcastChannel: BroadcastChannel | undefined;

const getLocalImageBroadcastChannel = () => {
  if (typeof BroadcastChannel === "undefined") return undefined;
  if (!localImageBroadcastChannel) {
    localImageBroadcastChannel = new BroadcastChannel(
      LOCAL_IMAGE_BROADCAST_CHANNEL,
    );
  }
  return localImageBroadcastChannel;
};

type LocalImageChangeKind = "asset" | "thumbnail" | "upload-job";

const getLocalImageChangeEvent = (kind: LocalImageChangeKind) => {
  if (kind === "asset") return LOCAL_IMAGE_CHANGE_EVENT;
  if (kind === "thumbnail") return LOCAL_IMAGE_THUMBNAIL_CHANGE_EVENT;
  return LOCAL_IMAGE_UPLOAD_JOB_CHANGE_EVENT;
};

const notifyLocalImageChange = (
  assetId: string,
  kind: LocalImageChangeKind,
) => {
  const eventName = getLocalImageChangeEvent(kind);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(eventName, { detail: { assetId } }));
  }
  getLocalImageBroadcastChannel()?.postMessage({ assetId, kind });
};

const subscribeLocalImageChangeKind = (
  kind: LocalImageChangeKind,
  listener: (assetId: string) => void,
) => {
  const eventName = getLocalImageChangeEvent(kind);
  const onLocalChange = (event: Event) => {
    const assetId = (event as CustomEvent<{ assetId?: unknown }>).detail
      ?.assetId;
    if (typeof assetId === "string" && assetId) listener(assetId);
  };
  const onBroadcastChange = (event: MessageEvent<unknown>) => {
    const data = event.data as {
      assetId?: unknown;
      kind?: unknown;
    } | null;
    if (data?.kind !== kind) return;
    const assetId = data.assetId;
    if (typeof assetId === "string" && assetId) listener(assetId);
  };
  window.addEventListener(eventName, onLocalChange);
  const channel = getLocalImageBroadcastChannel();
  channel?.addEventListener("message", onBroadcastChange);
  return () => {
    window.removeEventListener(eventName, onLocalChange);
    channel?.removeEventListener("message", onBroadcastChange);
  };
};

export const subscribeLocalImageChanges = (
  listener: (assetId: string) => void,
) => subscribeLocalImageChangeKind("asset", listener);

export const subscribeLocalImageThumbnailChanges = (
  listener: (assetId: string) => void,
) => subscribeLocalImageChangeKind("thumbnail", listener);

export const subscribeLocalImageUploadJobChanges = (
  listener: (assetId: string) => void,
) => subscribeLocalImageChangeKind("upload-job", listener);

export const openLocalAssetDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error("Local image storage is not available in this browser."),
      );
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      const imageStore = db.objectStoreNames.contains(STORE_NAME)
        ? transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (imageStore && !imageStore.indexNames.contains(WORKSPACE_INDEX_NAME)) {
        imageStore.createIndex(WORKSPACE_INDEX_NAME, WORKSPACE_INDEX_NAME, {
          unique: false,
        });
      }
      if (!db.objectStoreNames.contains(UPLOAD_JOB_STORE_NAME)) {
        const jobStore = db.createObjectStore(UPLOAD_JOB_STORE_NAME, {
          keyPath: "id",
        });
        jobStore.createIndex(WORKSPACE_INDEX_NAME, WORKSPACE_INDEX_NAME, {
          unique: false,
        });
      }
      if (!db.objectStoreNames.contains(THUMBNAIL_STORE_NAME)) {
        db.createObjectStore(THUMBNAIL_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(LOCAL_VIDEO_STORE_NAME)) {
        const videoStore = db.createObjectStore(LOCAL_VIDEO_STORE_NAME, {
          keyPath: "id",
        });
        videoStore.createIndex(WORKSPACE_INDEX_NAME, WORKSPACE_INDEX_NAME, {
          unique: false,
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Local image storage could not be opened."),
      );
    request.onblocked = () =>
      reject(new Error("Close other WorshipSync windows, then try again."));
  });

export const buildLocalImageUrl = (assetId: string) =>
  `${LOCAL_IMAGE_URL_PREFIX}${encodeURIComponent(assetId)}`;

export const isLocalImageUrl = (value: string | undefined) =>
  Boolean(value?.startsWith(LOCAL_IMAGE_URL_PREFIX));

export const validateLocalImageFile = (file: File): string | null => {
  if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return "Choose a PNG, JPEG, WebP, or GIF image.";
  }
  if (file.size <= 0) return "Choose an image that is not empty.";
  if (!window.electronAPI && file.size > MAX_LOCAL_IMAGE_BYTES) {
    return "Choose an image smaller than 25 MB.";
  }
  return null;
};

export const readImageDimensions = (file: File) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
        return;
      }
      reject(new Error("The selected image has invalid dimensions."));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected image could not be read."));
    };
    image.src = url;
  });

export const getLocalAssetThumbnailDimensions = (
  width: number,
  height: number,
) => {
  const scale = Math.min(
    THUMBNAIL_MAX_WIDTH / width,
    THUMBNAIL_MAX_HEIGHT / height,
    1,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

export const encodeLocalAssetThumbnailBlob = async (
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ blob: Blob; width: number; height: number } | undefined> => {
  if (
    typeof document === "undefined" ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return undefined;
  }
  const { width, height } = getLocalAssetThumbnailDimensions(
    sourceWidth,
    sourceHeight,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return undefined;
  context.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | undefined>((resolve) => {
    canvas.toBlob(
      (value) => resolve(value ?? undefined),
      "image/webp",
      THUMBNAIL_QUALITY,
    );
  });
  if (!blob) return undefined;
  return { blob, width, height };
};

const createLocalImageThumbnail = async (
  image: StoredLocalImage,
): Promise<StoredLocalImageThumbnail | undefined> => {
  if (
    !image.blob ||
    typeof createImageBitmap !== "function" ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    return undefined;
  }
  const bitmap = await createImageBitmap(image.blob);
  try {
    const encoded = await encodeLocalAssetThumbnailBlob(
      bitmap,
      image.width,
      image.height,
    );
    if (!encoded) return undefined;
    return { id: image.id, createdAt: image.createdAt, ...encoded };
  } finally {
    bitmap.close();
  }
};

export const saveLocalImageThumbnail = async (
  thumbnail: StoredLocalImageThumbnail,
) => {
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(THUMBNAIL_STORE_NAME, "readwrite");
      transaction.objectStore(THUMBNAIL_STORE_NAME).put(thumbnail);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The local image thumbnail could not be saved."),
        );
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  notifyLocalImageChange(thumbnail.id, "thumbnail");
};

export const getLocalImageThumbnail = async (
  assetId: string,
): Promise<StoredLocalImageThumbnail | undefined> => {
  const db = await openLocalAssetDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(THUMBNAIL_STORE_NAME, "readonly");
      const request = transaction
        .objectStore(THUMBNAIL_STORE_NAME)
        .get(assetId);
      request.onsuccess = () =>
        resolve(request.result as StoredLocalImageThumbnail | undefined);
      request.onerror = () =>
        reject(
          request.error ??
            new Error("The local image thumbnail could not be read."),
        );
    });
  } finally {
    db.close();
  }
};

export const saveLocalImage = async (image: StoredLocalImage) => {
  const thumbnail = await createLocalImageThumbnail(image).catch(
    () => undefined,
  );
  const useElectronStore =
    Boolean(window.electronAPI?.importLocalAsset) && image.blob instanceof File;
  if (useElectronStore) {
    await window.electronAPI!.importLocalAsset(image.blob as File, {
      assetId: image.id,
      workspaceId: image.workspaceId,
      kind: "image",
      fileName: image.fileName,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
    });
  }
  const storedImage = useElectronStore ? { ...image, blob: undefined } : image;
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        [STORE_NAME, THUMBNAIL_STORE_NAME],
        "readwrite",
      );
      transaction.objectStore(STORE_NAME).put(storedImage);
      if (thumbnail) {
        transaction.objectStore(THUMBNAIL_STORE_NAME).put(thumbnail);
      } else {
        transaction.objectStore(THUMBNAIL_STORE_NAME).delete(image.id);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The image could not be saved locally."),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("The image could not be saved locally."),
        );
    });
    try {
      await navigator.storage?.persist?.();
    } catch {
      // Best effort. The durable IndexedDB copy is still valid without this hint.
    }
  } finally {
    db.close();
  }
  notifyLocalImageChange(image.id, "asset");
  notifyLocalImageChange(image.id, "thumbnail");
};

export const getLocalImage = async (
  assetId: string,
): Promise<StoredLocalImage | undefined> => {
  const db = await openLocalAssetDb();
  try {
    const stored = await new Promise<StoredLocalImage | undefined>(
      (resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(assetId);
        request.onsuccess = () =>
          resolve(request.result as StoredLocalImage | undefined);
        request.onerror = () =>
          reject(
            request.error ?? new Error("The local image could not be read."),
          );
      },
    );
    if (!stored || stored.blob || !window.electronAPI?.getLocalAsset) {
      return stored;
    }
    const localAsset = await window.electronAPI.getLocalAsset(assetId);
    if (!localAsset) return undefined;
    const response = await fetch(localAsset.url, { cache: "no-store" });
    if (!response.ok) return undefined;
    return { ...stored, blob: await response.blob() };
  } finally {
    db.close();
  }
};

const pendingThumbnailBackfills = new Map<
  string,
  Promise<StoredLocalImageThumbnail | undefined>
>();
let thumbnailBackfillQueue: Promise<void> = Promise.resolve();

/**
 * Legacy assets do not have the v3 thumbnail record. Generate at most one at a
 * time so an unvirtualized outline can never decode every original in parallel.
 */
export const getOrCreateLocalImageThumbnail = async (assetId: string) => {
  const existing = await getLocalImageThumbnail(assetId);
  if (existing) return existing;
  const pending = pendingThumbnailBackfills.get(assetId);
  if (pending) return pending;

  let resolveBackfill:
    | ((value: StoredLocalImageThumbnail | undefined) => void)
    | undefined;
  const backfill = new Promise<StoredLocalImageThumbnail | undefined>(
    (resolve) => {
      resolveBackfill = resolve;
    },
  );
  pendingThumbnailBackfills.set(assetId, backfill);
  thumbnailBackfillQueue = thumbnailBackfillQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const current = await getLocalImageThumbnail(assetId);
        if (current) {
          resolveBackfill?.(current);
          return;
        }
        const image = await getLocalImage(assetId);
        const thumbnail = image
          ? await createLocalImageThumbnail(image).catch(() => undefined)
          : undefined;
        if (thumbnail) await saveLocalImageThumbnail(thumbnail);
        resolveBackfill?.(thumbnail);
      } catch {
        resolveBackfill?.(undefined);
      } finally {
        pendingThumbnailBackfills.delete(assetId);
      }
    });
  return backfill;
};

export const deleteLocalImage = async (assetId: string) => {
  if (window.electronAPI?.deleteLocalAsset) {
    await window.electronAPI.deleteLocalAsset(assetId);
  }
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        [STORE_NAME, THUMBNAIL_STORE_NAME, UPLOAD_JOB_STORE_NAME],
        "readwrite",
      );
      transaction.objectStore(STORE_NAME).delete(assetId);
      transaction.objectStore(THUMBNAIL_STORE_NAME).delete(assetId);
      transaction.objectStore(UPLOAD_JOB_STORE_NAME).delete(assetId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The local image could not be removed."),
        );
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  notifyLocalImageChange(assetId, "asset");
  notifyLocalImageChange(assetId, "thumbnail");
  notifyLocalImageChange(assetId, "upload-job");
};

const getAllFromIndex = <T>(
  store: IDBObjectStore,
  workspaceId: string,
): Promise<T[]> =>
  new Promise((resolve, reject) => {
    const request = store.index(WORKSPACE_INDEX_NAME).getAll(workspaceId);
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Local image storage could not be read."),
      );
  });

export const listLocalImagesForWorkspace = async (workspaceId: string) => {
  const db = await openLocalAssetDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    return await getAllFromIndex<StoredLocalImage>(
      transaction.objectStore(STORE_NAME),
      workspaceId,
    );
  } finally {
    db.close();
  }
};

export const putLocalImageUploadJob = async (job: LocalImageUploadJob) => {
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(UPLOAD_JOB_STORE_NAME, "readwrite");
      transaction.objectStore(UPLOAD_JOB_STORE_NAME).put(job);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The image upload could not be queued."),
        );
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  notifyLocalImageChange(job.assetId, "upload-job");
};

export const getLocalImageUploadJob = async (
  assetId: string,
): Promise<LocalImageUploadJob | undefined> => {
  const db = await openLocalAssetDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(UPLOAD_JOB_STORE_NAME, "readonly");
      const request = transaction
        .objectStore(UPLOAD_JOB_STORE_NAME)
        .get(assetId);
      request.onsuccess = () =>
        resolve(request.result as LocalImageUploadJob | undefined);
      request.onerror = () =>
        reject(
          request.error ?? new Error("The image upload could not be read."),
        );
    });
  } finally {
    db.close();
  }
};

const mutateLocalImageUploadJob = async (
  assetId: string,
  mutation: (
    current: LocalImageUploadJob | undefined,
  ) => LocalImageUploadJob | undefined,
) => {
  const db = await openLocalAssetDb();
  let result: LocalImageUploadJob | undefined;
  let changed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(UPLOAD_JOB_STORE_NAME, "readwrite");
      const store = transaction.objectStore(UPLOAD_JOB_STORE_NAME);
      const request = store.get(assetId);
      request.onsuccess = () => {
        const current = request.result as LocalImageUploadJob | undefined;
        result = mutation(current);
        if (!result || result === current) return;
        store.put(result);
        changed = true;
      };
      request.onerror = () =>
        reject(request.error ?? new Error("The upload job could not be read."));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The upload job could not be updated."),
        );
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  if (changed) notifyLocalImageChange(assetId, "upload-job");
  return result;
};

export const enqueueLocalImageUploadJobAtomically = async (
  candidate: LocalImageUploadJob,
  now: number,
) =>
  mutateLocalImageUploadJob(candidate.assetId, (current) => {
    if (current?.leaseOwnerId && (current.leaseExpiresAt ?? 0) > now) {
      return current;
    }
    return {
      ...candidate,
      mediaId: current?.mediaId ?? candidate.mediaId,
      status: current?.cloudMedia ? "uploaded" : "pending",
      attemptCount: current?.attemptCount ?? candidate.attemptCount,
      nextAttemptAt: 0,
      lastError: undefined,
      cloudMedia: current?.cloudMedia,
      createdAt: current?.createdAt ?? candidate.createdAt,
    };
  });

export const retryLocalImageUploadJobAtomically = async (
  assetId: string,
  now: number,
) =>
  mutateLocalImageUploadJob(assetId, (current) => {
    if (!current) return undefined;
    if (current.leaseOwnerId && (current.leaseExpiresAt ?? 0) > now) {
      return current;
    }
    const next: LocalImageUploadJob = {
      ...current,
      status: current.cloudMedia ? "uploaded" : "pending",
      nextAttemptAt: 0,
      lastError: undefined,
      updatedAt: new Date(now).toISOString(),
    };
    delete next.leaseOwnerId;
    delete next.leaseExpiresAt;
    return next;
  });

type LeasedLocalImageUploadJobPatch = Partial<
  Pick<
    LocalImageUploadJob,
    "status" | "attemptCount" | "nextAttemptAt" | "lastError" | "cloudMedia"
  >
>;

export const updateLeasedLocalImageUploadJob = async ({
  assetId,
  leaseOwnerId,
  patch,
  now,
  leaseDurationMs,
}: {
  assetId: string;
  leaseOwnerId: string;
  patch: LeasedLocalImageUploadJobPatch;
  now: number;
  leaseDurationMs: number;
}) =>
  mutateLocalImageUploadJob(assetId, (current) => {
    if (!current || current.leaseOwnerId !== leaseOwnerId) return undefined;
    return {
      ...current,
      ...patch,
      leaseOwnerId,
      leaseExpiresAt: now + leaseDurationMs,
      updatedAt: new Date(now).toISOString(),
    };
  });

/**
 * Atomically claim a durable upload job. IndexedDB serializes read-write
 * transactions for this store, so concurrent controller tabs cannot both win.
 */
export const claimLocalImageUploadJob = async ({
  assetId,
  leaseOwnerId,
  now,
  leaseDurationMs,
}: {
  assetId: string;
  leaseOwnerId: string;
  now: number;
  leaseDurationMs: number;
}): Promise<LocalImageUploadJob | undefined> => {
  const db = await openLocalAssetDb();
  let claimed: LocalImageUploadJob | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(UPLOAD_JOB_STORE_NAME, "readwrite");
      const store = transaction.objectStore(UPLOAD_JOB_STORE_NAME);
      const request = store.get(assetId);
      request.onsuccess = () => {
        const current = request.result as LocalImageUploadJob | undefined;
        if (!current || !isLocalImageUploadJobRunnable(current, now)) return;
        claimed = {
          ...current,
          leaseOwnerId,
          leaseExpiresAt: now + leaseDurationMs,
          updatedAt: new Date(now).toISOString(),
        };
        store.put(claimed);
      };
      request.onerror = () =>
        reject(
          request.error ?? new Error("The upload job could not be claimed."),
        );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The upload job could not be claimed."),
        );
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  return claimed;
};

export const renewLocalImageUploadJobLease = async ({
  assetId,
  leaseOwnerId,
  now,
  leaseDurationMs,
}: {
  assetId: string;
  leaseOwnerId: string;
  now: number;
  leaseDurationMs: number;
}) => {
  const db = await openLocalAssetDb();
  let renewed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(UPLOAD_JOB_STORE_NAME, "readwrite");
      const store = transaction.objectStore(UPLOAD_JOB_STORE_NAME);
      const request = store.get(assetId);
      request.onsuccess = () => {
        const current = request.result as LocalImageUploadJob | undefined;
        if (!current || current.leaseOwnerId !== leaseOwnerId) return;
        store.put({
          ...current,
          leaseExpiresAt: now + leaseDurationMs,
          updatedAt: new Date(now).toISOString(),
        });
        renewed = true;
      };
      request.onerror = () =>
        reject(
          request.error ?? new Error("The upload lease could not be renewed."),
        );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The upload lease could not be renewed."),
        );
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  return renewed;
};

export const releaseLocalImageUploadJobLease = async (
  assetId: string,
  leaseOwnerId: string,
) => {
  const db = await openLocalAssetDb();
  let released = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(UPLOAD_JOB_STORE_NAME, "readwrite");
      const store = transaction.objectStore(UPLOAD_JOB_STORE_NAME);
      const request = store.get(assetId);
      request.onsuccess = () => {
        const current = request.result as LocalImageUploadJob | undefined;
        if (!current || current.leaseOwnerId !== leaseOwnerId) return;
        const next = { ...current };
        delete next.leaseOwnerId;
        delete next.leaseExpiresAt;
        next.updatedAt = new Date().toISOString();
        store.put(next);
        released = true;
      };
      request.onerror = () =>
        reject(
          request.error ?? new Error("The upload lease could not be released."),
        );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The upload lease could not be released."),
        );
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  if (released) notifyLocalImageChange(assetId, "upload-job");
  return released;
};

export const listLocalImageUploadJobs = async (workspaceId: string) => {
  const db = await openLocalAssetDb();
  try {
    const transaction = db.transaction(UPLOAD_JOB_STORE_NAME, "readonly");
    return await getAllFromIndex<LocalImageUploadJob>(
      transaction.objectStore(UPLOAD_JOB_STORE_NAME),
      workspaceId,
    );
  } finally {
    db.close();
  }
};

export const deleteLocalImageUploadJob = async (assetId: string) => {
  const db = await openLocalAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(UPLOAD_JOB_STORE_NAME, "readwrite");
      transaction.objectStore(UPLOAD_JOB_STORE_NAME).delete(assetId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("The image upload could not be removed."),
        );
      transaction.onabort = transaction.onerror;
    });
  } finally {
    db.close();
  }
  notifyLocalImageChange(assetId, "upload-job");
};

const getPolicyStorageKey = (workspaceId: string) =>
  `${POLICY_KEY_PREFIX}:${encodeURIComponent(workspaceId.trim() || "default")}`;

export const getRememberedLocalImagePolicy = (
  workspaceId: string,
): LocalAssetStoragePolicy => {
  if (typeof window === "undefined") return "local-only";
  try {
    const value = localStorage.getItem(getPolicyStorageKey(workspaceId));
    return value === "local-and-cloud" ? value : "local-only";
  } catch {
    return "local-only";
  }
};

export const rememberLocalImagePolicy = (
  workspaceId: string,
  policy: LocalAssetStoragePolicy,
) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getPolicyStorageKey(workspaceId), policy);
  } catch {
    // Private mode or quota errors should not block creating the item.
  }
};

export const attachCloudCopyToLocalImage = (
  media: MediaType,
  cloudCopy: { mediaId: string; url: string },
): MediaType => {
  if (!media.localImage) return media;
  return {
    ...media,
    updatedAt: new Date().toISOString(),
    localImage: {
      ...media.localImage,
      storagePolicy: "local-and-cloud",
      cloudMediaId: cloudCopy.mediaId,
      cloudUrl: cloudCopy.url,
    },
  };
};

export const attachCloudCopyToLocalImageItem = <
  T extends {
    slides: ItemSlideType[];
    arrangements: Arrangment[];
  },
>(
  item: T,
  assetId: string,
  cloudCopy: { mediaId: string; url: string },
): T => {
  const patchSlides = (slides: ItemSlideType[]) =>
    slides.map((slide) => ({
      ...slide,
      boxes: (slide.boxes ?? []).map((box) =>
        box.mediaInfo?.localImage?.id === assetId
          ? {
              ...box,
              mediaInfo: attachCloudCopyToLocalImage(box.mediaInfo, cloudCopy),
            }
          : box,
      ),
    }));

  return {
    ...item,
    slides: patchSlides(item.slides ?? []),
    arrangements: (item.arrangements ?? []).map((arrangement) => ({
      ...arrangement,
      slides: patchSlides(arrangement.slides ?? []),
    })),
  } as T;
};

export const updateLocalImageReferenceInItem = <
  T extends {
    slides: ItemSlideType[];
    arrangements: Arrangment[];
  },
>(
  item: T,
  assetId: string,
  patch: LocalImageReferencePatch,
): T => {
  const patchSlides = (slides: ItemSlideType[]) =>
    slides.map((slide) => ({
      ...slide,
      boxes: (slide.boxes ?? []).map((box) => {
        if (box.mediaInfo?.localImage?.id !== assetId) return box;
        return {
          ...box,
          mediaInfo: {
            ...box.mediaInfo,
            ...patch.media,
            updatedAt: new Date().toISOString(),
            localImage: {
              ...box.mediaInfo.localImage,
              ...patch.reference,
              id: assetId,
            },
          },
        };
      }),
    }));

  return {
    ...item,
    slides: patchSlides(item.slides ?? []),
    arrangements: (item.arrangements ?? []).map((arrangement) => ({
      ...arrangement,
      slides: patchSlides(arrangement.slides ?? []),
    })),
  } as T;
};

export const persistLocalImageReferencePatch = async ({
  db,
  itemId,
  assetId,
  patch,
}: {
  db: PouchDB.Database;
  itemId: string;
  assetId: string;
  patch: LocalImageReferencePatch;
}): Promise<DBItem> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const current: DBItem = await db.get(itemId);
      const patched = updateLocalImageReferenceInItem(current, assetId, patch);
      const next = applyPouchAudit(
        current,
        { ...patched, updatedAt: new Date().toISOString() },
        { isNew: false },
      );
      const response = await db.put(next);
      return { ...next, _rev: response.rev };
    } catch (error) {
      lastError = error;
      if ((error as { status?: number })?.status !== 409) break;
    }
  }
  throw lastError ?? new Error("The outline item could not be updated.");
};

export const persistLocalImageCloudCopy = async ({
  db,
  itemId,
  assetId,
  mediaId,
  url,
}: {
  db: PouchDB.Database;
  itemId: string;
  assetId: string;
  mediaId: string;
  url: string;
}): Promise<DBItem> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const current: DBItem = await db.get(itemId);
      const patched = attachCloudCopyToLocalImageItem(current, assetId, {
        mediaId,
        url,
      });
      const next = applyPouchAudit(
        current,
        { ...patched, updatedAt: new Date().toISOString() },
        { isNew: false },
      );
      const response = await db.put(next);
      return { ...next, _rev: response.rev };
    } catch (error) {
      lastError = error;
      if ((error as { status?: number })?.status !== 409) break;
    }
  }
  throw lastError ?? new Error("The outline item could not be updated.");
};

export const collectLocalImageAssetIds = (
  item: Pick<DBItem, "slides" | "arrangements">,
) => {
  const ids = new Set<string>();
  const collect = (slides: ItemSlideType[]) => {
    slides.forEach((slide) =>
      (slide.boxes ?? []).forEach((box) => {
        const id = box.mediaInfo?.localImage?.id;
        if (id) ids.add(id);
      }),
    );
  };
  collect(item.slides ?? []);
  item.arrangements?.forEach((arrangement) =>
    collect(arrangement.slides ?? []),
  );
  return ids;
};

const isPersistedItem = (value: unknown): value is DBItem => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DBItem>;
  return (
    typeof candidate._id === "string" &&
    (Array.isArray(candidate.slides) || Array.isArray(candidate.arrangements))
  );
};

export const cleanupOrphanedLocalImages = async ({
  db,
  workspaceId,
  minimumAgeMs = 30 * 24 * 60 * 60 * 1000,
}: {
  db: PouchDB.Database;
  workspaceId: string;
  minimumAgeMs?: number;
}) => {
  if (!workspaceId) return 0;
  const [storedImages, allDocs] = await Promise.all([
    listLocalImagesForWorkspace(workspaceId),
    db.allDocs({ include_docs: true }),
  ]);
  const referenced = new Set<string>();
  allDocs.rows.forEach((row) => {
    const mediaDoc = row.doc as Partial<DBMedia> | undefined;
    if (mediaDoc?._id === "media" && Array.isArray(mediaDoc.list)) {
      mediaDoc.list.forEach((media) => {
        const id = media.localImage?.id;
        if (id) referenced.add(id);
      });
    }
    if (!isPersistedItem(row.doc)) return;
    collectLocalImageAssetIds(row.doc).forEach((id) => referenced.add(id));
  });
  const cutoff = Date.now() - minimumAgeMs;
  const orphaned = storedImages.filter(
    (image) =>
      !referenced.has(image.id) &&
      Number.isFinite(Date.parse(image.createdAt)) &&
      Date.parse(image.createdAt) <= cutoff,
  );
  await Promise.all(orphaned.map((image) => deleteLocalImage(image.id)));
  return orphaned.length;
};

export const cleanupLocalImagesForDeletedItem = async ({
  db,
  item,
  beforeDelete,
}: {
  db: PouchDB.Database;
  item: DBItem;
  beforeDelete?: (assetId: string) => Promise<void>;
}) => {
  const candidateIds = collectLocalImageAssetIds(item);
  if (candidateIds.size === 0) return 0;
  const allDocs = await db.allDocs({ include_docs: true });
  allDocs.rows.forEach((row) => {
    if (!isPersistedItem(row.doc)) return;
    collectLocalImageAssetIds(row.doc).forEach((id) => candidateIds.delete(id));
  });
  await Promise.all(
    [...candidateIds].map(async (id) => {
      await beforeDelete?.(id);
      await deleteLocalImage(id);
    }),
  );
  return candidateIds.size;
};

export const normalizeLocalImageReference = (
  value: unknown,
): LocalImageAssetReference | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const clean = (field: string, max = 512) =>
    typeof candidate[field] === "string"
      ? candidate[field].trim().slice(0, max)
      : "";
  const id = clean("id");
  const ownerDeviceId = clean("ownerDeviceId");
  if (!id || !ownerDeviceId) return undefined;
  const storagePolicy =
    candidate.storagePolicy === "local-and-cloud"
      ? "local-and-cloud"
      : "local-only";
  const cloudUrl = normalizeCloudinaryUrl(clean("cloudUrl", 2048));
  return {
    id,
    ...(clean("contentRevision")
      ? { contentRevision: clean("contentRevision") }
      : {}),
    ownerDeviceId,
    ownerLabel: clean("ownerLabel", 120) || "source device",
    fileName: clean("fileName", 255) || "Local image",
    contentType: clean("contentType", 120) || "image/jpeg",
    storagePolicy,
    ...(cloudUrl ? { cloudUrl } : {}),
    ...(clean("cloudMediaId") ? { cloudMediaId: clean("cloudMediaId") } : {}),
  };
};
