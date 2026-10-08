import type { ContentPreviewResolvedSource } from "./contentPreview";

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const EXPIRY_MARGIN_MS = 45 * 1000;
const MAX_ENTRIES = 100;
const RESOLUTION_TIMEOUT_MS = 30 * 1000;

/** Descriptors only: no renderer state or file bodies. Owned by the preview caller. */
export const createPreviewSourceCache = (now = () => Date.now()) => {
  const entries = new Map<string, { source: ContentPreviewResolvedSource; validUntil: number }>();
  const pending = new Map<string, Promise<ContentPreviewResolvedSource | null>>();

  const resolve = (key: string, load: () => Promise<ContentPreviewResolvedSource | null>) => {
    const cached = entries.get(key);
    if (cached && cached.validUntil > now()) return Promise.resolve(cached.source);
    entries.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;

    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The preview could not be prepared in time.")), RESOLUTION_TIMEOUT_MS);
    });
    const work = Promise.race([(async () => load())(), timeout]).then((source) => {
      if (source && source.sourceKind !== "unavailable" && !source.reason && source.url) {
        const expiry = source.expiresAt ? Date.parse(source.expiresAt) : NaN;
        const validUntil = Number.isFinite(expiry) ? expiry - EXPIRY_MARGIN_MS : now() + DEFAULT_TTL_MS;
        if (validUntil > now()) {
          entries.set(key, { source, validUntil });
          while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
        }
      }
      return source;
    }).finally(() => {
      clearTimeout(timer);
      pending.delete(key);
    });
    pending.set(key, work);
    return work;
  };
  return { resolve };
};

export type PreviewSourceCache = ReturnType<typeof createPreviewSourceCache>;
