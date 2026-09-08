import {
  getLocalImage,
  getOrCreateLocalImageThumbnail,
  subscribeLocalImageChanges,
  subscribeLocalImageThumbnailChanges,
} from "./localImageAssets";

type CacheEntry = {
  promise: Promise<string | undefined>;
  objectUrl?: string;
  references: number;
  cleanupTimer?: number;
  disposed: boolean;
  shouldRevoke: boolean;
};

const fullImageCache = new Map<string, CacheEntry>();
const thumbnailCache = new Map<string, CacheEntry>();
const RELEASE_GRACE_MS = 10_000;
const LEGACY_CONTENT_REVISION = "legacy";

const getCacheKey = (assetId: string, contentRevision?: string) =>
  JSON.stringify([assetId, contentRevision || LEGACY_CONTENT_REVISION]);

const createEntry = (
  assetId: string,
  loadBlob: (assetId: string) => Promise<{ blob?: Blob } | undefined>,
): CacheEntry => {
  const entry: CacheEntry = {
    references: 0,
    disposed: false,
    shouldRevoke: true,
    promise: Promise.resolve(undefined),
  };
  entry.promise = loadBlob(assetId)
    .then((stored) => {
      if (!stored?.blob) return undefined;
      const objectUrl = URL.createObjectURL(stored.blob);
      if (entry.disposed) {
        URL.revokeObjectURL(objectUrl);
        return undefined;
      }
      entry.objectUrl = objectUrl;
      return entry.objectUrl;
    })
    .catch(() => undefined);
  return entry;
};

const createElectronEntry = (assetId: string): CacheEntry => {
  const entry: CacheEntry = {
    references: 0,
    disposed: false,
    shouldRevoke: false,
    promise: Promise.resolve(undefined),
  };
  entry.promise = window
    .electronAPI!.getLocalAsset(assetId)
    .then(async (asset) => {
      if (entry.disposed) return undefined;
      if (asset) {
        entry.objectUrl = asset.url;
        return asset.url;
      }

      // Assets created by older Electron builds still live in IndexedDB.
      // Preserve them until the operator relinks instead of making an upgrade
      // silently blank an existing service outline.
      const legacy = await getLocalImage(assetId);
      if (!legacy?.blob) return undefined;
      const objectUrl = URL.createObjectURL(legacy.blob);
      if (entry.disposed) {
        URL.revokeObjectURL(objectUrl);
        return undefined;
      }
      entry.shouldRevoke = true;
      entry.objectUrl = objectUrl;
      return objectUrl;
    })
    .catch(() => undefined);
  return entry;
};

const disposeEntry = (
  cache: Map<string, CacheEntry>,
  assetId: string,
  entry: CacheEntry,
) => {
  if (cache.get(assetId) === entry) cache.delete(assetId);
  if (entry.disposed) return;
  entry.disposed = true;
  if (entry.cleanupTimer) window.clearTimeout(entry.cleanupTimer);
  if (entry.objectUrl && entry.shouldRevoke) {
    URL.revokeObjectURL(entry.objectUrl);
  }
};

const acquireUrl = (
  cache: Map<string, CacheEntry>,
  assetId: string,
  contentRevision: string | undefined,
  loadBlob: (assetId: string) => Promise<{ blob?: Blob } | undefined>,
) => {
  const cacheKey = getCacheKey(assetId, contentRevision);
  let entry = cache.get(cacheKey);
  if (!entry) {
    entry = createEntry(assetId, loadBlob);
    cache.set(cacheKey, entry);
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
      entry.cleanupTimer = window.setTimeout(() => {
        if (entry.references === 0) disposeEntry(cache, cacheKey, entry);
      }, RELEASE_GRACE_MS);
    },
  };
};

const acquireElectronUrl = (
  assetId: string,
  contentRevision: string | undefined,
) => {
  const cacheKey = getCacheKey(assetId, contentRevision);
  let entry = fullImageCache.get(cacheKey);
  if (!entry) {
    entry = createElectronEntry(assetId);
    fullImageCache.set(cacheKey, entry);
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
      entry.cleanupTimer = window.setTimeout(() => {
        if (entry.references === 0) {
          disposeEntry(fullImageCache, cacheKey, entry);
        }
      }, RELEASE_GRACE_MS);
    },
  };
};

export const acquireLocalImageUrl = (
  assetId: string,
  contentRevision?: string,
) =>
  window.electronAPI?.getLocalAsset
    ? acquireElectronUrl(assetId, contentRevision)
    : acquireUrl(fullImageCache, assetId, contentRevision, getLocalImage);

export const acquireLocalImageThumbnailUrl = (
  assetId: string,
  contentRevision?: string,
) =>
  acquireUrl(
    thumbnailCache,
    assetId,
    contentRevision,
    getOrCreateLocalImageThumbnail,
  );

/** Return an already-created URL without starting an IndexedDB read. */
export const peekLocalImageUrl = (assetId: string, contentRevision?: string) =>
  fullImageCache.get(getCacheKey(assetId, contentRevision))?.objectUrl;

/** Return an already-created thumbnail URL without starting an IndexedDB read. */
export const peekLocalImageThumbnailUrl = (
  assetId: string,
  contentRevision?: string,
) => thumbnailCache.get(getCacheKey(assetId, contentRevision))?.objectUrl;

const invalidateUrl = (cache: Map<string, CacheEntry>, assetId: string) => {
  // References created before byte revisions were persisted still need an
  // explicit invalidation. Versioned entries remain addressable so an outgoing
  // live frame can reacquire its exact old URL during a relink crossfade; the
  // normal lease grace disposes them once the transition is finished.
  const cacheKey = getCacheKey(assetId);
  const entry = cache.get(cacheKey);
  if (!entry) return;
  // A live legacy reference has no revision key to distinguish its old bytes
  // from a replacement. Keep that active URL pinned until the relink action
  // publishes a revisioned current frame and the outgoing lease releases.
  if (entry.references > 0) return;
  cache.delete(cacheKey);
  // Existing displays can keep rendering the old URL while the replacement is
  // read and crossfaded. Their lease release starts the normal cleanup grace.
  if (!entry.cleanupTimer) {
    entry.cleanupTimer = window.setTimeout(
      () => disposeEntry(cache, cacheKey, entry),
      RELEASE_GRACE_MS,
    );
  }
};

export const invalidateLocalImageUrl = (assetId: string) =>
  invalidateUrl(fullImageCache, assetId);

export const invalidateLocalImageThumbnailUrl = (assetId: string) =>
  invalidateUrl(thumbnailCache, assetId);

subscribeLocalImageChanges(invalidateLocalImageUrl);
subscribeLocalImageThumbnailChanges(invalidateLocalImageThumbnailUrl);
