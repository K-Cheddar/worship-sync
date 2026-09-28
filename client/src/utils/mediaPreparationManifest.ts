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
  /** Unique finite playable identities in the full inventory. */
  finiteCandidateCount: number;
  /** Unique HLS/non-finite sources waiting for a finite local cache rendition. */
  pendingCacheCount: number;
  /** For new reports, ready/preparing/failed partition selected finite candidates; legacy v1 reports retain their original interpretation. */
  excludedCount?: number;
  readyCount: number;
  preparingCount: number;
  failedCount: number;
  /** Pending/excluded failures are from selected candidates only. */
  pendingCacheFailedCount?: number;
  excludedFailedCount?: number;
  /** Effective bounded pool selection, including protected transition candidates. */
  selectedCandidateCount?: number;
  selectedFiniteCandidateCount?: number;
  selectedPendingCacheCount?: number;
  selectedExcludedCount?: number;
  /** Selected finite identities that belong to the inventory; protected extras are separate. */
  selectedFiniteInventoryCount?: number;
  /** Inventory finite identities omitted by the bounded pool. */
  deferredFiniteCount?: number;
  /** Number of preparation surfaces actually mounted for the selected set. */
  mountedSurfaceCount?: number;
  /** Optional bounded details; absent on older clients. */
  videos?: MediaPreparationReadinessVideo[];
  videosTruncated?: boolean;
  errors: string[];
};

export type MediaPreparationReadinessVideoStatus =
  | "playing"
  | "ready"
  | "preparing"
  | "failed"
  | "pending-cache"
  | "deferred"
  | "excluded";

export type MediaPreparationReadinessVideo = {
  mediaKey: string;
  name?: string;
  itemId?: string;
  itemName?: string;
  status: MediaPreparationReadinessVideoStatus;
  error?: string;
};

export type MediaPreparationReadinessVideoInput = {
  mediaKey: string;
  name?: string;
  itemId?: string;
  itemName?: string;
  status: ReadinessCandidateState;
  selected?: boolean;
  phase?: ReadinessSurfacePhase;
  error?: string;
};

const READINESS_VIDEO_LIMIT = 64;
const readinessVideoStatusOrder: Record<MediaPreparationReadinessVideoStatus, number> = {
  failed: 0,
  preparing: 1,
  "pending-cache": 1,
  playing: 2,
  ready: 3,
  deferred: 4,
  excluded: 4,
};

export const sanitizeMediaPreparationReadinessText = (value: string | undefined, limit = 120): string | undefined => {
  if (!value) return undefined;
  const safe = value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "")
    .replace(/(?:\b[A-Za-z]:\\|\\\\)[^\s]*/g, "")
    .replace(/(^|[\s(])\/[A-Za-z0-9._-]+(?:\/[^\s,;)]*)*/g, "$1")
    .replace(/\b(?:token|sig(?:nature)?|auth(?:orization)?|secret|password|credential|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, "")
    .replace(/[?#].*$/, "")
    .replace(/[\\/]+/g, " ")
    .trim()
    .slice(0, limit);
  return safe || undefined;
};

export const getMediaReadinessFileName = (source: string | undefined): string | undefined => {
  if (!source) return undefined;
  const withoutQuery = source.split(/[?#]/, 1)[0];
  const fileName = withoutQuery.split(/[\\/]/).filter(Boolean).at(-1);
  return sanitizeMediaPreparationReadinessText(fileName);
};

const safeReadinessMediaKey = (mediaKey: string): string => {
  if (!/[\\/?#]|:\/\/|(?:^|[:?&_-])(?:token|sig(?:nature)?|secret|password|credential|auth|key)=/i.test(mediaKey)) return mediaKey.slice(0, 160);
  let hash = 2166136261;
  for (let index = 0; index < mediaKey.length; index += 1) {
    hash = Math.imul(hash ^ mediaKey.charCodeAt(index), 16777619);
  }
  return `video-${(hash >>> 0).toString(16)}`;
};

/** Derives display-only video rows from the same inventory and surface state as the aggregate report. */
export const buildMediaPreparationReadinessVideos = (
  inputs: MediaPreparationReadinessVideoInput[],
): { videos: MediaPreparationReadinessVideo[]; videosTruncated: boolean } => {
  const byKey = new Map<string, MediaPreparationReadinessVideoInput>();
  const phasePriority = (phase: ReadinessSurfacePhase | undefined) =>
    phase === "active-playing" || phase === "playing" ? 5
      : phase === "ready-paused" || phase === "ready" ? 4
        : phase === "preparing" || phase === "activation-requested" || phase === "loading" ? 3
          : phase === "error" ? 2 : 0;
  const candidatePriority: Record<ReadinessCandidateState, number> = { excluded: 0, "pending-cache": 1, eligible: 2 };
  inputs.forEach((input) => {
    const current = byKey.get(input.mediaKey);
    if (!current) {
      byKey.set(input.mediaKey, input);
      return;
    }
    const preferred = phasePriority(input.phase) > phasePriority(current.phase) || (!current.itemName && input.itemName)
      ? input
      : current;
    byKey.set(input.mediaKey, {
      ...preferred,
      status: candidatePriority[input.status] > candidatePriority[current.status] ? input.status : current.status,
      selected: Boolean(current.selected || input.selected),
      name: preferred.name ?? current.name ?? input.name,
      itemId: preferred.itemId ?? current.itemId ?? input.itemId,
      itemName: preferred.itemName ?? current.itemName ?? input.itemName,
    });
  });
  const videos = [...byKey.values()].map((video) => {
    const phase = video.phase;
    const status: MediaPreparationReadinessVideoStatus =
      phase === "active-playing" || phase === "playing" ? "playing"
        : phase === "ready-paused" || phase === "ready" ? "ready"
          : phase === "error" ? "failed"
            : phase === "preparing" || phase === "activation-requested" || phase === "loading" || (video.selected && video.status === "eligible") ? "preparing"
              : video.status === "pending-cache" ? "pending-cache"
                : video.status === "excluded" ? "excluded"
                  : "deferred";
    const fallbackName = sanitizeMediaPreparationReadinessText(video.name) ?? sanitizeMediaPreparationReadinessText(video.itemName) ?? sanitizeMediaPreparationReadinessText(video.mediaKey) ?? "Video";
    return {
      mediaKey: safeReadinessMediaKey(video.mediaKey),
      name: fallbackName,
      ...(video.itemId && { itemId: sanitizeMediaPreparationReadinessText(video.itemId) }),
      ...(video.itemName && sanitizeMediaPreparationReadinessText(video.itemName) && { itemName: sanitizeMediaPreparationReadinessText(video.itemName) }),
      status,
      ...(status === "failed" && video.error && { error: sanitizeMediaPreparationReadinessText(video.error, 180) }),
    } satisfies MediaPreparationReadinessVideo;
  }).sort((left, right) => readinessVideoStatusOrder[left.status] - readinessVideoStatusOrder[right.status] || (left.name ?? left.mediaKey).localeCompare(right.name ?? right.mediaKey));
  return { videos: videos.slice(0, READINESS_VIDEO_LIMIT), videosTruncated: videos.length > READINESS_VIDEO_LIMIT };
};

export type ReadinessCandidateState = "eligible" | "pending-cache" | "excluded";
export type ReadinessSurfacePhase = "ready-paused" | "active-playing" | "preparing" | "activation-requested" | "error" | string;

/** Counts one state per unique media identity; playing and ready are the same ready population. */
export const buildMediaPreparationReadinessCounts = (
  candidates: Array<{ mediaKey: string; status: ReadinessCandidateState }>,
  surfaces: Array<{ mediaKey: string; phase: ReadinessSurfacePhase }>,
  selectedCandidates: Array<{ mediaKey: string; status: ReadinessCandidateState }> = candidates,
  mountedSurfaceCount?: number,
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
  const selectedByKey = new Map<string, ReadinessCandidateState>();
  selectedCandidates.forEach(({ mediaKey, status }) => {
    const current = selectedByKey.get(mediaKey);
    if (!current || priority[status] > priority[current]) selectedByKey.set(mediaKey, status);
  });
  const selectedFinite = new Set([...selectedByKey].filter(([, status]) => status === "eligible").map(([key]) => key));
  const selectedPending = new Set([...selectedByKey].filter(([, status]) => status === "pending-cache").map(([key]) => key));
  const selectedExcluded = new Set([...selectedByKey].filter(([, status]) => status === "excluded").map(([key]) => key));
  const stateByKey = new Map<string, "ready" | "preparing" | "failed">();
  surfaces.forEach(({ mediaKey, phase }) => {
    if (!finite.has(mediaKey) && !pending.has(mediaKey) && !excluded.has(mediaKey) && !selectedByKey.has(mediaKey)) return;
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
  const selectedReadyCount = [...stateByKey].filter(([key, state]) => selectedFinite.has(key) && state === "ready").length;
  const selectedPreparingCount = [...stateByKey].filter(([key, state]) => selectedFinite.has(key) && state === "preparing").length;
  const selectedFailedCount = [...stateByKey].filter(([key, state]) => selectedFinite.has(key) && state === "failed").length;
  const selectedFiniteInventoryCount = [...selectedFinite].filter((key) => finite.has(key)).length;
  return {
    candidateCount: byKey.size,
    finiteCandidateCount: finite.size,
    pendingCacheCount: pending.size,
    excludedCount: excluded.size,
    selectedCandidateCount: selectedByKey.size,
    selectedFiniteCandidateCount: selectedFinite.size,
    selectedPendingCacheCount: selectedPending.size,
    selectedExcludedCount: selectedExcluded.size,
    selectedFiniteInventoryCount,
    deferredFiniteCount: Math.max(0, finite.size - selectedFiniteInventoryCount),
    mountedSurfaceCount: Math.max(0, Math.min(selectedByKey.size, Math.floor(mountedSurfaceCount ?? selectedFinite.size))),
    readyCount: selectedReadyCount,
    preparingCount: selectedPreparingCount,
    failedCount: selectedFailedCount,
    pendingCacheFailedCount: [...failed].filter((key) => selectedPending.has(key)).length,
    excludedFailedCount: [...failed].filter((key) => selectedExcluded.has(key)).length,
  };
};

export const isMediaPreparationReadinessReport = (
  value: unknown,
): value is MediaPreparationReadinessReport => {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<MediaPreparationReadinessReport>;
  const count = (entry: unknown) => Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) <= 50_000;
  const selectedFields = [
    report.selectedCandidateCount, report.selectedFiniteCandidateCount,
    report.selectedPendingCacheCount, report.selectedExcludedCount,
    report.selectedFiniteInventoryCount, report.deferredFiniteCount,
    report.mountedSurfaceCount,
  ];
  const hasSelection = selectedFields.some((entry) => entry !== undefined);
  const validVideos = report.videos === undefined || (
    Array.isArray(report.videos) && report.videos.length <= READINESS_VIDEO_LIMIT &&
    report.videos.every((video) => {
      if (!video || typeof video !== "object") return false;
      const candidate = video as Partial<MediaPreparationReadinessVideo>;
      const safeText = (text: unknown, max: number) => text === undefined || (
        typeof text === "string" && text.length <= max && !/[\\/]|:\/\/|[?#]/.test(text) &&
        !/\b(?:token|sig(?:nature)?|auth(?:orization)?|secret|password|credential|api[-_]?key)\s*[:=]/i.test(text)
      );
      return typeof candidate.mediaKey === "string" && candidate.mediaKey.length > 0 && candidate.mediaKey.length <= 160 && safeText(candidate.mediaKey, 160) &&
        safeText(candidate.name, 120) &&
        safeText(candidate.itemId, 120) &&
        safeText(candidate.itemName, 120) &&
        ["playing", "ready", "preparing", "failed", "pending-cache", "deferred", "excluded"].includes(candidate.status ?? "") &&
        safeText(candidate.error, 180);
    })
  );
  const validSelection = !hasSelection || (
    selectedFields.every(count) &&
    Number(report.selectedFiniteCandidateCount) + Number(report.selectedPendingCacheCount) + Number(report.selectedExcludedCount) === Number(report.selectedCandidateCount) &&
    Number(report.selectedFiniteInventoryCount) <= Number(report.finiteCandidateCount) &&
    Number(report.selectedFiniteInventoryCount) + Number(report.deferredFiniteCount) === Number(report.finiteCandidateCount) &&
    Number(report.mountedSurfaceCount) <= Number(report.selectedCandidateCount) &&
    Number(report.readyCount) + Number(report.preparingCount) + Number(report.failedCount) <= Number(report.selectedFiniteCandidateCount) &&
    Number(report.pendingCacheFailedCount ?? 0) <= Number(report.selectedPendingCacheCount) &&
    Number(report.excludedFailedCount ?? 0) <= Number(report.selectedExcludedCount)
  );
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
    (hasSelection || Number(report.readyCount) + Number(report.preparingCount) + Number(report.failedCount) <= Number(report.finiteCandidateCount)) &&
    validSelection &&
    validVideos &&
    (report.videosTruncated === undefined || typeof report.videosTruncated === "boolean") &&
    (hasSelection
      ? Number(report.pendingCacheFailedCount ?? 0) <= Number(report.selectedPendingCacheCount)
      : Number(report.pendingCacheFailedCount ?? 0) <= Number(report.pendingCacheCount)) &&
    (hasSelection
      ? Number(report.excludedFailedCount ?? 0) <= Number(report.selectedExcludedCount)
      : Number(report.excludedFailedCount ?? 0) <= Number(report.excludedCount ?? 0)) &&
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
