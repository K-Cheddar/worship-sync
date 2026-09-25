import type { ElectronMediaSurfaceCandidate } from "./electronMediaSurfacePool";
import type { ElectronMediaDiscovery } from "./electronMediaSurfaceDiagnostics";
import { isHLSVideoSource } from "./isInstantVideoSource";
import { isPlayableMediaSource } from "./mediaSource";

export const MEDIA_PREPARATION_MANIFEST_VERSION = 1 as const;

export type MediaPreparationManifestMedia = {
  mediaKey: string;
  source: {
    kind: "remote-url";
    url: string;
  };
};

export type MediaPreparationManifestItem = {
  itemId: string;
  itemIndex: number;
  itemName: string;
  media: MediaPreparationManifestMedia[];
};

export type MediaPreparationManifest = {
  contract: "worshipsync.media-preparation";
  version: typeof MEDIA_PREPARATION_MANIFEST_VERSION;
  revision: number;
  publishedAt: number;
  outputId: string;
  controllerProfileId?: string;
  controllerProfileName?: string;
  outlineScope?: string;
  outlineId?: string | null;
  outlineName?: string;
  items: MediaPreparationManifestItem[];
};

export type MediaPreparationReadinessReport = {
  contract: "worshipsync.media-preparation-readiness";
  version: 1;
  outputId: string;
  deviceId: string;
  sessionId: string;
  reportedAt: number;
  manifestRevision: number | null;
  manifestReceivedAt: number | null;
  source: "remote-manifest" | "cached-manifest" | "local-fallback" | "browser-poster";
  /** Unique media identities in this report's inventory population. */
  candidateCount: number;
  /** Unique finite playable sources; readiness states below partition only this population. */
  finiteCandidateCount: number;
  /** Unique HLS/non-finite sources waiting for a finite local cache rendition. */
  pendingCacheCount: number;
  /** Failures are partitioned by source population; finite counts below only describe finite playable sources. */
  excludedCount?: number;
  readyCount: number;
  preparingCount: number;
  failedCount: number;
  pendingCacheFailedCount?: number;
  excludedFailedCount?: number;
  errors: string[];
};

export type ReadinessCandidateState = "eligible" | "pending-cache" | "excluded";
export type ReadinessSurfacePhase = "ready-paused" | "active-playing" | "preparing" | "activation-requested" | "error" | string;

/** Counts one state per unique media identity; playing and ready are the same ready population. */
export const buildMediaPreparationReadinessCounts = (
  candidates: Array<{ mediaKey: string; status: ReadinessCandidateState }>,
  surfaces: Array<{ mediaKey: string; phase: ReadinessSurfacePhase }>,
) => {
  const byKey = new Map<string, ReadinessCandidateState>();
  const priority: Record<ReadinessCandidateState, number> = { excluded: 0, "pending-cache": 1, eligible: 2 };
  candidates.forEach(({ mediaKey, status }) => {
    const current = byKey.get(mediaKey);
    if (!current || priority[status] > priority[current]) byKey.set(mediaKey, status);
  });
  const finite = new Set([...byKey].filter(([, status]) => status === "eligible").map(([key]) => key));
  const pending = new Set([...byKey].filter(([, status]) => status === "pending-cache").map(([key]) => key));
  const excluded = new Set([...byKey].filter(([, status]) => status === "excluded").map(([key]) => key));
  const stateByKey = new Map<string, "ready" | "preparing" | "failed">();
  surfaces.forEach(({ mediaKey, phase }) => {
    if (!finite.has(mediaKey) && !pending.has(mediaKey) && !excluded.has(mediaKey)) return;
    const next = phase === "ready-paused" || phase === "active-playing"
      ? "ready"
      : phase === "preparing" || phase === "activation-requested"
        ? "preparing"
        : phase === "error" ? "failed" : undefined;
    const current = stateByKey.get(mediaKey);
    if (next === "ready" || (next === "preparing" && current !== "ready") || (!current && next)) {
      stateByKey.set(mediaKey, next);
    }
  });
  const failed = new Set([...stateByKey].filter(([, state]) => state === "failed").map(([key]) => key));
  return {
    candidateCount: byKey.size,
    finiteCandidateCount: finite.size,
    pendingCacheCount: pending.size,
    excludedCount: excluded.size,
    readyCount: [...stateByKey].filter(([key, state]) => finite.has(key) && state === "ready").length,
    preparingCount: [...stateByKey].filter(([key, state]) => finite.has(key) && state === "preparing").length,
    failedCount: [...stateByKey].filter(([key, state]) => finite.has(key) && state === "failed").length,
    pendingCacheFailedCount: [...failed].filter((key) => pending.has(key)).length,
    excludedFailedCount: [...failed].filter((key) => excluded.has(key)).length,
  };
};

export const isMediaPreparationReadinessReport = (
  value: unknown,
): value is MediaPreparationReadinessReport => {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<MediaPreparationReadinessReport>;
  const count = (entry: unknown) => Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) <= 50_000;
  return (
    report.contract === "worshipsync.media-preparation-readiness" &&
    report.version === 1 &&
    typeof report.outputId === "string" && report.outputId.length > 0 && report.outputId.length <= 128 &&
    typeof report.deviceId === "string" && report.deviceId.length > 0 && report.deviceId.length <= 128 &&
    typeof report.sessionId === "string" && report.sessionId.length > 0 && report.sessionId.length <= 128 &&
    Number.isFinite(report.reportedAt) &&
    (report.manifestRevision === null || count(report.manifestRevision)) &&
    (report.manifestReceivedAt === null || Number.isFinite(report.manifestReceivedAt)) &&
    (report.source === "remote-manifest" || report.source === "cached-manifest" || report.source === "local-fallback" || report.source === "browser-poster") &&
    count(report.candidateCount) &&
    count(report.finiteCandidateCount) &&
    count(report.pendingCacheCount) &&
    count(report.readyCount) &&
    count(report.preparingCount) &&
    count(report.failedCount) &&
    (report.excludedCount === undefined || count(report.excludedCount)) &&
    (report.pendingCacheFailedCount === undefined || count(report.pendingCacheFailedCount)) &&
    (report.excludedFailedCount === undefined || count(report.excludedFailedCount)) &&
    Number(report.finiteCandidateCount) <= Number(report.candidateCount) &&
    Number(report.pendingCacheCount) <= Number(report.candidateCount) &&
    Number(report.excludedCount ?? 0) <= Number(report.candidateCount) &&
    Number(report.finiteCandidateCount) + Number(report.pendingCacheCount) + Number(report.excludedCount ?? 0) <= Number(report.candidateCount) &&
    Number(report.readyCount) + Number(report.preparingCount) + Number(report.failedCount) <= Number(report.finiteCandidateCount) &&
    Number(report.pendingCacheFailedCount ?? 0) <= Number(report.pendingCacheCount) &&
    Number(report.excludedFailedCount ?? 0) <= Number(report.excludedCount ?? 0) &&
    (report.source !== "remote-manifest" || (report.manifestRevision !== null && report.manifestReceivedAt !== null)) &&
    (report.source !== "cached-manifest" || (report.manifestRevision !== null && report.manifestReceivedAt === null)) &&
    Array.isArray(report.errors) &&
    report.errors.length <= 8 &&
    report.errors.every((error) => typeof error === "string" && error.length <= 180)
  );
};

/**
 * This is a portability and serialization check, not the network security
 * boundary. Electron's main-process safeHttpGet performs DNS, address, and
 * redirect validation before fetching. Manifests only carry portable HTTP(S)
 * URLs and reject renderer-local schemes, obvious local hosts, and credentials.
 */
export const isTransportSafeMediaUrl = (value: string | undefined): value is string => {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return !(
      hostname === "localhost" ||
      hostname === "ip6-localhost" ||
      hostname === "0.0.0.0" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
};

const getManifestItems = (
  discovery: ElectronMediaDiscovery,
): MediaPreparationManifestItem[] =>
  discovery.items
    .map((item) => {
      const media = new Map<string, MediaPreparationManifestMedia>();
      item.videos
        .filter((video) => video.status !== "excluded")
        .forEach((video) => {
          const url =
            video.transportSource ?? video.originalSource ?? video.source;
          if (!isTransportSafeMediaUrl(url) || media.has(video.mediaKey)) return;
          media.set(video.mediaKey, {
            mediaKey: video.mediaKey,
            source: { kind: "remote-url", url },
          });
        });
      return {
        itemId: item.itemId,
        itemIndex: item.itemIndex,
        itemName: item.itemName,
        media: [...media.values()].sort((left, right) =>
          left.mediaKey.localeCompare(right.mediaKey),
        ),
      };
    })
    .filter((item) => item.media.length > 0)
    .sort((left, right) => left.itemIndex - right.itemIndex || left.itemId.localeCompare(right.itemId));

export const getMediaPreparationManifestStructure = (
  manifest: Pick<
    MediaPreparationManifest,
    | "outputId"
    | "controllerProfileId"
    | "outlineScope"
    | "outlineId"
    | "items"
  >,
) =>
  JSON.stringify({
    outputId: manifest.outputId,
    controllerProfileId: manifest.controllerProfileId ?? null,
    outlineScope: manifest.outlineScope ?? null,
    outlineId: manifest.outlineId ?? null,
    items: manifest.items,
  });

export const buildMediaPreparationManifest = ({
  discovery,
  outputId,
  previous,
  publishedAt = Date.now(),
}: {
  discovery: ElectronMediaDiscovery;
  outputId: string;
  previous?: MediaPreparationManifest;
  publishedAt?: number;
}): MediaPreparationManifest => {
  const items = getManifestItems(discovery);
  const nextShape = {
    outputId,
    controllerProfileId: discovery.controllerProfileId,
    outlineScope: discovery.outlineScope,
    outlineId: discovery.outlineId ?? discovery.targetOutlineId ?? null,
    items,
  };
  const structure = getMediaPreparationManifestStructure(nextShape);
  const previousStructure = previous
    ? getMediaPreparationManifestStructure(previous)
    : undefined;
  const outlineName = discovery.outlineName ?? discovery.targetOutlineName;
  return {
    contract: "worshipsync.media-preparation",
    version: MEDIA_PREPARATION_MANIFEST_VERSION,
    revision:
      previous && previousStructure === structure
        ? previous.revision
        : (previous?.revision ?? 0) + 1,
    publishedAt,
    outputId,
    ...(discovery.controllerProfileId !== undefined && {
      controllerProfileId: discovery.controllerProfileId,
    }),
    ...(discovery.controllerProfileName !== undefined && {
      controllerProfileName: discovery.controllerProfileName,
    }),
    ...(discovery.outlineScope !== undefined && {
      outlineScope: discovery.outlineScope,
    }),
    outlineId: nextShape.outlineId,
    ...(outlineName !== undefined && { outlineName }),
    items,
  };
};

export const isMediaPreparationManifest = (
  value: unknown,
): value is MediaPreparationManifest => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MediaPreparationManifest>;
  const isRecord = (entry: unknown): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object");
  const validItems = Array.isArray(candidate.items) && candidate.items.every((item) => {
    if (!isRecord(item)) return false;
    if (
      typeof item.itemId !== "string" ||
      item.itemId.length === 0 ||
      !Number.isInteger(item.itemIndex) ||
      item.itemIndex < 0 ||
      typeof item.itemName !== "string" ||
      !Array.isArray(item.media)
    ) {
      return false;
    }
    return item.media.every((media) => {
      if (
        !isRecord(media) ||
        typeof media.mediaKey !== "string" ||
        media.mediaKey.length === 0
      ) return false;
      const source = media.source;
      return (
        isRecord(source) &&
        source.kind === "remote-url" &&
        typeof source.url === "string" &&
        isTransportSafeMediaUrl(source.url)
      );
    });
  });
  return (
    candidate.contract === "worshipsync.media-preparation" &&
    candidate.version === MEDIA_PREPARATION_MANIFEST_VERSION &&
    typeof candidate.revision === "number" &&
    Number.isInteger(candidate.revision) &&
    candidate.revision >= 1 &&
    typeof candidate.publishedAt === "number" &&
    Number.isFinite(candidate.publishedAt) &&
    typeof candidate.outputId === "string" &&
    candidate.outputId.length > 0 &&
    (candidate.controllerProfileId === undefined ||
      typeof candidate.controllerProfileId === "string") &&
    (candidate.outlineScope === undefined ||
      typeof candidate.outlineScope === "string") &&
    (candidate.outlineId === undefined ||
      candidate.outlineId === null ||
      typeof candidate.outlineId === "string") &&
    (candidate.outlineName === undefined ||
      typeof candidate.outlineName === "string") &&
    validItems
  );
};

export const mediaPreparationManifestToCandidates = (
  manifest: MediaPreparationManifest | undefined,
  cacheMap: Record<string, string> = {},
): ElectronMediaSurfaceCandidate[] =>
  manifest?.items.flatMap((item) =>
    item.media.map((media) => {
      const cachedSource = cacheMap[media.source.url];
      const useCache =
        Boolean(cachedSource) &&
        !isHLSVideoSource(cachedSource) &&
        isPlayableMediaSource(cachedSource);
      return {
        mediaKey: media.mediaKey,
        source: useCache ? cachedSource : media.source.url,
        originalSource: media.source.url,
        sourceKind: useCache ? ("cache" as const) : ("remote" as const),
        itemId: item.itemId,
        itemIndex: item.itemIndex,
        itemName: item.itemName,
        reason: useCache
          ? "renderer-local cached finite source"
          : "remote preparation manifest",
      };
    }),
  ) ?? [];
