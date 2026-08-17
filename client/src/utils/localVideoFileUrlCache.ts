import {
  getLocalVideoFile,
  getOrCreateLocalVideoFileThumbnail,
  subscribeLocalVideoFileChanges,
} from "./localVideoFileAssets";

type CacheEntry = {
  promise: Promise<string | undefined>;
  url?: string;
  references: number;
  cleanupTimer?: number;
  shouldRevoke: boolean;
  disposed: boolean;
};

const cache = new Map<string, CacheEntry>();
const thumbnailCache = new Map<string, CacheEntry>();
const RELEASE_GRACE_MS = 10_000;

const cacheKey = (assetId: string, contentRevision?: string) =>
  JSON.stringify([assetId, contentRevision || "legacy"]);

const createEntry = (assetId: string): CacheEntry => {
  const entry: CacheEntry = {
    promise: Promise.resolve(undefined),
    references: 0,
    shouldRevoke: !window.electronAPI?.getLocalAsset,
    disposed: false,
  };
  entry.promise = (async () => {
    if (window.electronAPI?.getLocalAsset) {
      const asset = await window.electronAPI.getLocalAsset(assetId);
      if (asset) {
        if (entry.disposed) return undefined;
        entry.url = asset.url;
        entry.shouldRevoke = false;
        return asset.url;
      }
    }
    const stored = await getLocalVideoFile(assetId);
    if (!stored?.blob) return undefined;
    const url = URL.createObjectURL(stored.blob);
    if (entry.disposed) {
      URL.revokeObjectURL(url);
      return undefined;
    }
    entry.url = url;
    entry.shouldRevoke = true;
    return url;
  })().catch(() => undefined);
  return entry;
};

const dispose = (
  store: Map<string, CacheEntry>,
  key: string,
  entry: CacheEntry,
) => {
  if (store.get(key) === entry) store.delete(key);
  if (entry.disposed) return;
  entry.disposed = true;
  if (entry.cleanupTimer) window.clearTimeout(entry.cleanupTimer);
  if (entry.url && entry.shouldRevoke) URL.revokeObjectURL(entry.url);
};

const createThumbnailEntry = (assetId: string): CacheEntry => {
  const entry: CacheEntry = {
    promise: Promise.resolve(undefined),
    references: 0,
    shouldRevoke: true,
    disposed: false,
  };
  entry.promise = (async () => {
    const stored = await getOrCreateLocalVideoFileThumbnail(assetId);
    if (!stored?.blob) return undefined;
    const url = URL.createObjectURL(stored.blob);
    if (entry.disposed) {
      URL.revokeObjectURL(url);
      return undefined;
    }
    entry.url = url;
    return url;
  })().catch(() => undefined);
  return entry;
};

const acquireFromCache = (
  store: Map<string, CacheEntry>,
  assetId: string,
  contentRevision: string | undefined,
  create: (assetId: string) => CacheEntry,
) => {
  const key = cacheKey(assetId, contentRevision);
  let entry = store.get(key);
  if (!entry) {
    entry = create(assetId);
    store.set(key, entry);
  }
  if (entry.cleanupTimer) {
    window.clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = undefined;
  }
  entry.references += 1;
  let released = false;
  return {
    url: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.references = Math.max(0, entry.references - 1);
      if (entry.references > 0 || entry.cleanupTimer) return;
      entry.cleanupTimer = window.setTimeout(
        () => dispose(store, key, entry),
        RELEASE_GRACE_MS,
      );
    },
  };
};

export const acquireLocalVideoFileUrl = (
  assetId: string,
  contentRevision?: string,
) => acquireFromCache(cache, assetId, contentRevision, createEntry);

export const acquireLocalVideoFileThumbnailUrl = (
  assetId: string,
  contentRevision?: string,
) =>
  acquireFromCache(
    thumbnailCache,
    assetId,
    contentRevision,
    createThumbnailEntry,
  );

export const peekLocalVideoFileUrl = (
  assetId: string,
  contentRevision?: string,
) => cache.get(cacheKey(assetId, contentRevision))?.url;

export const peekLocalVideoFileThumbnailUrl = (
  assetId: string,
  contentRevision?: string,
) => thumbnailCache.get(cacheKey(assetId, contentRevision))?.url;

const invalidateCache = (
  store: Map<string, CacheEntry>,
  assetId: string,
) => {
  for (const [key, entry] of store) {
    const [cachedAssetId] = JSON.parse(key) as [string];
    if (cachedAssetId !== assetId || entry.references > 0) continue;
    dispose(store, key, entry);
  }
};

const invalidateLocalVideoFileUrl = (assetId: string) => {
  invalidateCache(cache, assetId);
  invalidateCache(thumbnailCache, assetId);
};

subscribeLocalVideoFileChanges(invalidateLocalVideoFileUrl);
