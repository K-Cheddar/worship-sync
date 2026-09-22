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
  | "not-cacheable"
  | "not-required";

export type ElectronMediaDiscoveryRenderer = "projector" | "editor";

export type ElectronMediaDiscoveryVideo = {
  mediaKey: string;
  source: string;
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
  currentItemId?: string;
  itemCount: number;
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
  geometryReady?: boolean;
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

export type ElectronMediaSurfacePoolDiagnostics = {
  outputId?: string;
  windowRole: string;
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
  renderPath?: "pool" | "fallback";
  lastSendPath?: "pool" | "fallback";
  lastMediaKey?: string;
  posterShown?: boolean;
  rendererMetrics?: PreparedVideoMetrics;
  discovery?: ElectronMediaDiscovery;
};

export type ElectronMediaSurfaceDiagnosticsMessage =
  | { type: "snapshot"; diagnostics: ElectronMediaSurfacePoolDiagnostics }
  | { type: "request" };

export const ELECTRON_MEDIA_SURFACE_DIAGNOSTICS_CHANNEL =
  "worship-sync-electron-media-surface-diagnostics";

export const summarizeElectronMediaSurfaceDiagnostics = ({
  outputId,
  windowRole,
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
  discovery?: ElectronMediaDiscovery;
}): ElectronMediaSurfacePoolDiagnostics => ({
  outputId,
  windowRole,
  candidateCount,
  discoveredCount:
    discoveredCount ?? candidateDetails?.length ?? candidateCount,
  pendingCacheCount:
    pendingCacheCount ??
    candidateDetails?.filter(
      (candidate) =>
        candidate.status === "pending-cache" ||
        candidate.cacheStatus === "pending",
    ).length ??
    0,
  finiteVideoCount,
  serviceItemCount,
  currentItemId,
  currentItemVideoCount,
  currentItemReadyCount,
  poolCapacity,
  surfaceCount: surfaces.length,
  readyCount: surfaces.filter((surface) => surface.phase === "ready").length,
  preparingCount: surfaces.filter((surface) =>
    ["loading", "preparing"].includes(surface.phase),
  ).length,
  playingCount: surfaces.filter((surface) => surface.phase === "playing").length,
  resettingCount: surfaces.filter((surface) => surface.phase === "resetting").length,
  errorCount: surfaces.filter((surface) => surface.phase === "error").length,
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
  const channel = getDiagnosticsChannel();
  if (!channel) return;
  channel.postMessage({ type: "request" } satisfies ElectronMediaSurfaceDiagnosticsMessage);
  channel.close();
};

export const subscribeToElectronMediaSurfaceDiagnostics = (
  onDiagnostics: (diagnostics: ElectronMediaSurfacePoolDiagnostics) => void,
  onRequest?: () => void,
): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const onWindowMessage = (event: Event) => {
    const diagnostics = (event as CustomEvent<ElectronMediaSurfacePoolDiagnostics>).detail;
    if (diagnostics?.windowRole) onDiagnostics(diagnostics);
  };
  window.addEventListener("worship-sync-media-surface-diagnostics", onWindowMessage);
  const channel = getDiagnosticsChannel();
  if (!channel) {
    return () => window.removeEventListener("worship-sync-media-surface-diagnostics", onWindowMessage);
  }
  channel.onmessage = (event: MessageEvent<ElectronMediaSurfaceDiagnosticsMessage>) => {
    if (event.data.type === "snapshot") onDiagnostics(event.data.diagnostics);
    if (event.data.type === "request") onRequest?.();
  };
  return () => {
    window.removeEventListener("worship-sync-media-surface-diagnostics", onWindowMessage);
    channel.close();
  };
};
