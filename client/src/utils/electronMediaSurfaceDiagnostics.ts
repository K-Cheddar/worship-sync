import type { PreparedVideoMetrics } from "../types/electron";

export type ElectronMediaCandidateSourceKind =
  | "cache"
  | "local"
  | "remote"
  | "hls"
  | "local-capture"
  | "unknown";

export type ElectronMediaCandidateStatus =
  | "eligible"
  | "pending-cache"
  | "excluded";

export type ElectronMediaCandidateCacheStatus =
  | "cached"
  | "pending"
  | "cache-in-progress"
  | "unavailable"
  | "retry-scheduled"
  | "not-cacheable"
  | "not-required";

export type ElectronMediaSurfaceGeometryReason =
  | "source-mismatch"
  | "surface-size-zero"
  | "video-size-zero"
  | "stage-size-mismatch"
  | "disconnected"
  | "hidden"
  | "no-presented-frame";

export type ElectronMediaOutlineLoadState =
  | "loading"
  | "loaded"
  | "error"
  | "retrying";
export type ElectronMediaInventoryState = "complete" | "incomplete" | "invalid";

export type ElectronMediaDiscoveryRenderer = "projector" | "editor";

export type ElectronMediaDiscoveryVideo = {
  mediaKey: string;
  source: string;
  /** Original portable source before a renderer-local cache/path adapter. */
  originalSource?: string;
  /** Cloud-backed source for a file that is local on the controller. */
  transportSource?: string;
  resolvedSource?: string;
  sourceKind: ElectronMediaCandidateSourceKind;
  status: ElectronMediaCandidateStatus;
  cacheStatus: ElectronMediaCandidateCacheStatus;
};

export type ElectronMediaDiscovery = {
  renderer: ElectronMediaDiscoveryRenderer;
  outputId?: string;
  controllerProfileId?: string;
  controllerProfileName?: string;
  outlineScope?: string;
  outlineId?: string | null;
  outlineName?: string;
  targetOutlineId?: string | null;
  targetOutlineName?: string;
  loadedOutlineId?: string;
  loadedOutlineName?: string;
  outlineLoadState?: ElectronMediaOutlineLoadState;
  outlineLoadError?: string;
  outlineRetryAttempt?: number;
  outlineRetryAt?: number;
  inventoryState?: ElectronMediaInventoryState;
  missingItemIds?: string[];
  invalidItemIds?: string[];
  contextSource?:
    | "local runtime selection"
    | "persisted ItemLists fallback"
    | "effective mirrored output source";
  currentItemId?: string;
  expectedItemCount?: number;
  itemCount: number;
  uniqueVideoInventoryCount?: number;
  finitePlayableSourceCount?: number;
  pendingHlsCacheCount?: number;
  intentionallyExcludedVideoCount?: number;
  uniqueFiniteVideoCount: number;
  items: Array<{
    itemIndex: number;
    itemId: string;
    itemName: string;
    videos: ElectronMediaDiscoveryVideo[];
  }>;
};

export type ElectronMediaSurfaceCandidateDiagnostic = {
  mediaKey: string;
  originalSource: string;
  transportSource?: string;
  resolvedSource?: string;
  sourceKind: ElectronMediaCandidateSourceKind;
  status: ElectronMediaCandidateStatus;
  cacheStatus: ElectronMediaCandidateCacheStatus;
  eligible: boolean;
  reason: string;
  itemId?: string;
  itemName?: string;
  itemIndex?: number;
  isCurrentItem?: boolean;
  priority?: number;
  protected?: boolean;
  surfaceState?: "COLD" | "PREPARING" | "READY" | "ACTIVE";
};

export type ElectronMediaSurfacePhase =
  | "idle"
  | "loading"
  | "preparing"
  | "ready"
  | "playing"
  | "resetting"
  | "disposed"
  | "error";

export type ElectronMediaSurfaceDiagnostic = {
  mediaKey: string;
  source: string;
  phase: ElectronMediaSurfacePhase;
  sourceKind: "cache" | "local" | "remote";
  renderer?: ElectronMediaDiscoveryRenderer;
  surfaceState?: "COLD" | "PREPARING" | "READY" | "ACTIVE";
  lifecyclePhase?:
    | "candidate"
    | "preparing"
    | "ready-paused"
    | "activation-requested"
    | "active-playing"
    | "retiring/resetting"
    | "error"
    | "disposed";
  lifecycleRoute?: string;
  lifecycleRole?: string;
  lifecycleOutlineId?: string | null;
  lifecycleGeneration?: number;
  lifecycleFrame?: {
    mediaTime?: number;
    presentedFrames?: number;
    currentTime?: number;
    expectedDisplayTime?: number;
  };
  geometryReady?: boolean;
  geometryReason?: ElectronMediaSurfaceGeometryReason;
  framePresentedReady?: boolean;
  expectedSource?: string;
  actualCurrentSrc?: string;
  canonicalSourceMatch?: boolean;
  surfaceRect?: { x: number; y: number; width: number; height: number };
  videoRect?: { x: number; y: number; width: number; height: number };
  intrinsicVideoSize?: { width: number; height: number };
  objectFit?: string;
  sourceUnchanged?: boolean;
  priority?: number;
  protected?: boolean;
  prepareToFrameReadyMs?: number;
  sendStateBeforeRequest?: "COLD" | "PREPARING" | "READY" | "ACTIVE";
  sendCurrentTime?: number;
  sendReadyState?: number;
  sendPaused?: boolean;
  sendSeeking?: boolean;
  sendBufferedRanges?: Array<[number, number]>;
  sendRequestTimestamp?: number;
  sendTimestamp?: number;
  wasReadyBeforeSend?: boolean;
  playCalledTimestamp?: number;
  playRequestTimestamp?: number;
  playResolvedTimestamp?: number;
  transitionStartTimestamp?: number;
  firstAdvancingFrameTimestamp?: number;
  transitionCompleteTimestamp?: number;
  sendToTransitionStartMs?: number;
  sendToPlayRequestMs?: number;
  sendToPlayResolvedMs?: number;
  sendToFirstAdvancingFrameMs?: number;
  lastUsedAt?: number;
  error?: string;
};

export type VideoTransitionPath =
  | "prepared-video"
  | "poster-then-video"
  | "video-fallback"
  | "waiting-for-visual";

export type ElectronMediaSurfacePoolDiagnostics = {
  diagnosticId?: string;
  outputId?: string;
  windowRole: string;
  transitionDurationMs?: number;
  preparationSource?: "local-pouchdb" | "server-manifest" | "cached-manifest" | "local-fallback";
  manifestRevision?: number;
  manifestOutlineId?: string | null;
  manifestOutlineName?: string;
  manifestPublishedAt?: number;
  candidateCount: number;
  discoveredCount: number;
  finiteVideoCount?: number;
  serviceItemCount?: number;
  currentItemId?: string;
  currentItemVideoCount?: number;
  currentItemReadyCount?: number;
  poolCapacity?: number;
  pendingCacheCount: number;
  surfaceCount: number;
  readyCount: number;
  preparingCount: number;
  playingCount: number;
  resettingCount: number;
  errorCount: number;
  evictions: string[];
  candidateDetails?: ElectronMediaSurfaceCandidateDiagnostic[];
  surfaces: ElectronMediaSurfaceDiagnostic[];
  renderPath?: VideoTransitionPath;
  lastSendPath?: VideoTransitionPath;
  lastMediaKey?: string;
  posterShown?: boolean;
  rendererMetrics?: PreparedVideoMetrics;
  discovery?: ElectronMediaDiscovery;
};

export type ElectronMediaSurfaceDiagnosticsMessage =
  | { type: "snapshot"; diagnostics: ElectronMediaSurfacePoolDiagnostics }
  | { type: "request" }
  | { type: "close" }
  | { type: "retry"; outputId?: string; mediaKeys: string[] };

export const ELECTRON_MEDIA_SURFACE_DIAGNOSTICS_CHANNEL =
  "worship-sync-electron-media-surface-diagnostics";
const LOCAL_DIAGNOSTICS_REQUEST_EVENT = "worship-sync-media-surface-diagnostics-request";
const LOCAL_DIAGNOSTICS_CLOSE_EVENT = "worship-sync-media-surface-diagnostics-close";

export const summarizeElectronMediaSurfaceDiagnostics = ({
  diagnosticId,
  outputId,
  windowRole,
  transitionDurationMs,
  preparationSource,
  manifestRevision,
  manifestOutlineId,
  manifestOutlineName,
  manifestPublishedAt,
  candidateCount,
  discoveredCount,
  pendingCacheCount,
  candidateDetails,
  surfaces,
  renderPath,
  evictions,
  lastSendPath,
  lastMediaKey,
  posterShown,
  rendererMetrics,
  discovery,
  finiteVideoCount,
  serviceItemCount,
  currentItemId,
  currentItemVideoCount,
  currentItemReadyCount,
  poolCapacity,
  surfaceCount,
  readyCount,
  preparingCount,
  playingCount,
  resettingCount,
  errorCount,
}: Omit<
  ElectronMediaSurfacePoolDiagnostics,
  | "surfaceCount"
  | "readyCount"
  | "preparingCount"
  | "playingCount"
  | "resettingCount"
  | "errorCount"
  | "discoveredCount"
  | "pendingCacheCount"
  | "finiteVideoCount"
  | "serviceItemCount"
  | "currentItemId"
  | "currentItemVideoCount"
  | "currentItemReadyCount"
  | "poolCapacity"
  | "surfaceCount"
  | "readyCount"
  | "preparingCount"
  | "playingCount"
  | "resettingCount"
  | "errorCount"
  | "discovery"
> & {
  discoveredCount?: number;
  pendingCacheCount?: number;
  finiteVideoCount?: number;
  serviceItemCount?: number;
  currentItemId?: string;
  currentItemVideoCount?: number;
  currentItemReadyCount?: number;
  poolCapacity?: number;
  surfaceCount?: number;
  readyCount?: number;
  preparingCount?: number;
  playingCount?: number;
  resettingCount?: number;
  errorCount?: number;
  discovery?: ElectronMediaDiscovery;
}): ElectronMediaSurfacePoolDiagnostics => ({
  diagnosticId,
  outputId,
  windowRole,
  transitionDurationMs,
  preparationSource,
  manifestRevision,
  manifestOutlineId,
  manifestOutlineName,
  manifestPublishedAt,
  candidateCount,
  discoveredCount:
    discoveredCount ?? candidateDetails?.length ?? candidateCount,
  pendingCacheCount:
    pendingCacheCount ??
    candidateDetails?.filter(
      (candidate) =>
        candidate.cacheStatus === "pending" ||
        candidate.cacheStatus === "cache-in-progress" ||
        candidate.cacheStatus === "retry-scheduled",
    ).length ??
    0,
  finiteVideoCount,
  serviceItemCount,
  currentItemId,
  currentItemVideoCount,
  currentItemReadyCount,
  poolCapacity,
  surfaceCount: surfaceCount ?? surfaces.length,
  readyCount: readyCount ?? surfaces.filter((surface) => surface.phase === "ready").length,
  preparingCount: preparingCount ?? surfaces.filter((surface) =>
    ["loading", "preparing"].includes(surface.phase),
  ).length,
  playingCount: playingCount ?? surfaces.filter((surface) => surface.phase === "playing").length,
  resettingCount: resettingCount ?? surfaces.filter((surface) => surface.phase === "resetting").length,
  errorCount: errorCount ?? surfaces.filter((surface) => surface.phase === "error").length,
  evictions,
  candidateDetails,
  surfaces,
  renderPath,
  lastSendPath,
  lastMediaKey,
  posterShown,
  rendererMetrics,
  discovery,
});

const getDiagnosticsChannel = (): BroadcastChannel | undefined => {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return undefined;
  }
  return new BroadcastChannel(ELECTRON_MEDIA_SURFACE_DIAGNOSTICS_CHANNEL);
};

export const publishElectronMediaSurfaceDiagnostics = (
  diagnostics: ElectronMediaSurfacePoolDiagnostics,
): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("worship-sync-media-surface-diagnostics", {
      detail: diagnostics,
    }),
  );
  const channel = getDiagnosticsChannel();
  if (!channel) return;
  channel.postMessage({ type: "snapshot", diagnostics } satisfies ElectronMediaSurfaceDiagnosticsMessage);
  channel.close();
};

export const requestElectronMediaSurfaceDiagnostics = (): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCAL_DIAGNOSTICS_REQUEST_EVENT));
  }
  const channel = getDiagnosticsChannel();
  if (!channel) return;
  channel.postMessage({ type: "request" } satisfies ElectronMediaSurfaceDiagnosticsMessage);
  channel.close();
};

export const closeElectronMediaSurfaceDiagnostics = (): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCAL_DIAGNOSTICS_CLOSE_EVENT));
  }
  const channel = getDiagnosticsChannel();
  if (!channel) return;
  channel.postMessage({ type: "close" } satisfies ElectronMediaSurfaceDiagnosticsMessage);
  channel.close();
};

export const requestElectronMediaSurfaceRetry = ({
  outputId,
  mediaKeys,
}: {
  outputId?: string;
  mediaKeys: string[];
}): void => {
  const channel = getDiagnosticsChannel();
  if (!channel) return;
  channel.postMessage({
    type: "retry",
    outputId,
    mediaKeys: [...new Set(mediaKeys)].slice(0, 64),
  } satisfies ElectronMediaSurfaceDiagnosticsMessage);
  channel.close();
};

export const subscribeToElectronMediaSurfaceDiagnostics = (
  onDiagnostics: (diagnostics: ElectronMediaSurfacePoolDiagnostics) => void,
  onRequest?: () => void,
  onRetry?: (request: { outputId?: string; mediaKeys: string[] }) => void,
  onClose?: () => void,
): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const onWindowMessage = (event: Event) => {
    const diagnostics = (event as CustomEvent<ElectronMediaSurfacePoolDiagnostics>).detail;
    if (diagnostics?.windowRole) onDiagnostics(diagnostics);
  };
  window.addEventListener("worship-sync-media-surface-diagnostics", onWindowMessage);
  const onLocalRequest = () => onRequest?.();
  const onLocalClose = () => onClose?.();
  window.addEventListener(LOCAL_DIAGNOSTICS_REQUEST_EVENT, onLocalRequest);
  window.addEventListener(LOCAL_DIAGNOSTICS_CLOSE_EVENT, onLocalClose);
  const channel = getDiagnosticsChannel();
  if (!channel) {
    return () => {
      window.removeEventListener("worship-sync-media-surface-diagnostics", onWindowMessage);
      window.removeEventListener(LOCAL_DIAGNOSTICS_REQUEST_EVENT, onLocalRequest);
      window.removeEventListener(LOCAL_DIAGNOSTICS_CLOSE_EVENT, onLocalClose);
    };
  }
  channel.onmessage = (event: MessageEvent<ElectronMediaSurfaceDiagnosticsMessage>) => {
    if (event.data.type === "snapshot") onDiagnostics(event.data.diagnostics);
    if (event.data.type === "request") onRequest?.();
    if (event.data.type === "close") onClose?.();
    if (event.data.type === "retry") onRetry?.(event.data);
  };
  return () => {
    window.removeEventListener("worship-sync-media-surface-diagnostics", onWindowMessage);
    window.removeEventListener(LOCAL_DIAGNOSTICS_REQUEST_EVENT, onLocalRequest);
    window.removeEventListener(LOCAL_DIAGNOSTICS_CLOSE_EVENT, onLocalClose);
    channel.close();
  };
};
