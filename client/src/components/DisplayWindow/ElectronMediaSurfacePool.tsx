import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PreparedVideoMetrics } from "../../types/electron";
import {
  advancePreparedVideoSurface,
  beginPreparedVideoSurface,
  disposePreparedVideoSurface,
  getPreparedVideoSurfaceErrorMessage,
  initialPreparedVideoSurfaceState,
  type PreparedVideoSurfaceState,
} from "../../utils/preparedVideoSurfaceState";
import {
  type ElectronMediaSurfaceCandidate,
  type ElectronMediaSurfaceView,
} from "../../utils/electronMediaSurfacePool";
import {
  publishElectronMediaSurfaceDiagnostics,
  subscribeToElectronMediaSurfaceDiagnostics,
  summarizeElectronMediaSurfaceDiagnostics,
  type ElectronMediaSurfaceCandidateDiagnostic,
  type ElectronMediaSurfaceDiagnostic,
  type ElectronMediaDiscovery,
  type ElectronMediaDiscoveryRenderer,
} from "../../utils/electronMediaSurfaceDiagnostics";
import {
  resolveVideoCueDrift,
  resolveVideoCueCorrection,
  resolveVideoPlaybackPosition,
  VIDEO_CUE_RATE_CORRECTION_MAX_DURATION_MS,
} from "../../utils/videoBackgroundPlayback";
import { isHLSVideoSource } from "../../utils/isInstantVideoSource";
import {
  assignPlayableVideoSource,
  areEquivalentMediaSources,
  isPlayableMediaSource,
} from "../../utils/mediaSource";
import { parseLocalVideoFileAssetId } from "../../utils/localVideoFileAssets";
import { acquireLocalVideoFileUrl } from "../../utils/localVideoFileUrlCache";
import {
  isAdvancingMediaFrame,
  type MediaSurfaceFrameMetadata,
  type MediaSurfaceLifecyclePhase,
  type MediaSurfaceStatus,
} from "../../utils/mediaSurfaceLifecycle";
import { serverNow } from "../../utils/serverTime";

type SurfaceDiagnostic = ElectronMediaSurfaceDiagnostic;

type ElectronMediaSurfacePoolProps = {
  enabled: boolean;
  candidates: ElectronMediaSurfaceCandidate[];
  candidateDiagnostics?: ElectronMediaSurfaceCandidateDiagnostic[];
  views: ElectronMediaSurfaceView[];
  /** One authoritative lifecycle event stream shared by output and editor preview. */
  onStatusChange?: (status: MediaSurfaceStatus) => void;
  route?: string;
  role?: string;
  outlineId?: string | null;
  onReadyChange?: (mediaKey: string, ready: boolean) => void;
  onGeometryReadyChange?: (mediaKey: string, ready: boolean) => void;
  onFirstAdvancingFrameChange?: (mediaKey: string, observed: boolean) => void;
  onPreparationFailure?: (mediaKey: string, reason: string) => void;
  onSurfaceElement?: (mediaKey: string, element: HTMLDivElement | null) => void;
  onDiagnosticChange?: (diagnostic: SurfaceDiagnostic) => void;
  transitionStart?: {
    mediaKey: string;
    timestamp: number;
    controllerActionTimestamp?: number;
  };
  transitionVisible?: {
    mediaKey: string;
    timestamp: number;
    wallClockTimestamp: number;
    controllerActionTimestamp?: number;
  };
  transitionComplete?: { mediaKey: string; timestamp: number };
  lastSendPath?: "pool" | "fallback";
  lastMediaKey?: string;
  posterShown?: boolean;
  outputId?: string;
  windowRole?: string;
  discovery?: ElectronMediaDiscovery;
  poolCapacity?: number;
};

const PRESENTED_FRAME_TIMEOUT_MS = 5000;
const PREPARATION_WATCHDOG_MS = PRESENTED_FRAME_TIMEOUT_MS;

let nextPreparedSurfaceInstanceId = 0;
const NOOP = () => undefined;

const rendererForWindowRole = (
  windowRole: string | undefined,
): ElectronMediaDiscoveryRenderer =>
  windowRole === "editor"
    ? "editor"
    : windowRole?.endsWith("-preview")
      ? "projector-preview"
      : "projector";

type SurfaceRect = { x: number; y: number; width: number; height: number };

const snapshotRect = (element: Element | null): SurfaceRect | undefined => {
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
};

type PreparedSurfaceDebug = (
  event: string,
  details?: Record<string, unknown>,
) => void;

const surfaceStateForPhase = (
  phase: PreparedVideoSurfaceState["phase"],
): SurfaceDiagnostic["surfaceState"] => {
  if (phase === "ready") return "READY";
  if (phase === "playing") return "ACTIVE";
  if (["loading", "preparing", "resetting"].includes(phase)) {
    return "PREPARING";
  }
  return "COLD";
};

const surfaceStateForLifecycle = (
  phase: MediaSurfaceLifecyclePhase,
): SurfaceDiagnostic["surfaceState"] => {
  if (phase === "active-playing") return "ACTIVE";
  if (phase === "ready-paused") return "READY";
  if (phase === "candidate" || phase === "disposed") return "COLD";
  return "PREPARING";
};

const isImmediateSurfaceSource = (source: string): boolean =>
  source.startsWith("media-cache://") ||
  source.startsWith("worshipsync-media://");

const waitForVideoEvent = (
  video: HTMLVideoElement,
  event: "loadedmetadata" | "seeked",
): Promise<void> =>
  new Promise((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("video element error"));
    };
    const cleanup = () => {
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
    };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
  });

const waitForPresentedFrame = (
  video: HTMLVideoElement,
  debug?: PreparedSurfaceDebug,
): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      debug?.("TIMEOUT", { timeoutMs: PRESENTED_FRAME_TIMEOUT_MS });
      reject(new Error("presented-frame timeout"));
    }, PRESENTED_FRAME_TIMEOUT_MS);
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      debug?.("FRAME_CALLBACK_FIRED");
      resolve();
    };
    const videoWithFrameCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (videoWithFrameCallback.requestVideoFrameCallback) {
      debug?.("FRAME_CALLBACK_REGISTERED");
      videoWithFrameCallback.requestVideoFrameCallback(finish);
      return;
    }
    debug?.("FALLBACK_TWO_RAF_REGISTERED");
    window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
  });

type VideoWithFrameMetadata = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameCallbackMetadata) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
  getVideoPlaybackQuality?: () => { totalVideoFrames?: number };
};

const readFrameMetadata = (
  video: HTMLVideoElement,
  metadata?: Partial<VideoFrameCallbackMetadata>,
): MediaSurfaceFrameMetadata => {
  const quality = (video as VideoWithFrameMetadata).getVideoPlaybackQuality?.();
  return {
    mediaTime: metadata?.mediaTime,
    expectedDisplayTime: metadata?.expectedDisplayTime,
    presentedFrames:
      metadata?.presentedFrames ?? quality?.totalVideoFrames,
    currentTime: Number.isFinite(video.currentTime)
      ? video.currentTime
      : undefined,
  };
};

/** A frame callback alone is not evidence that playback advanced. */
const waitForAdvancingFrame = (
  video: HTMLVideoElement,
  debug?: PreparedSurfaceDebug,
): Promise<MediaSurfaceFrameMetadata> =>
  new Promise((resolve, reject) => {
    const frameVideo = video as VideoWithFrameMetadata;
    const baseline = readFrameMetadata(video);
    let settled = false;
    let frameRequest: number | undefined;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      if (frameRequest != null) frameVideo.cancelVideoFrameCallback?.(frameRequest);
      reject(new Error("advancing-frame timeout"));
    }, PRESENTED_FRAME_TIMEOUT_MS);

    const finish = (metadata: MediaSurfaceFrameMetadata) => {
      if (settled || !isAdvancingMediaFrame(baseline, metadata)) return false;
      settled = true;
      window.clearTimeout(timeoutId);
      debug?.("ADVANCING_FRAME_CONFIRMED", { metadata });
      resolve(metadata);
      return true;
    };

    const requestNext = () => {
      if (settled) return;
      if (frameVideo.requestVideoFrameCallback) {
        frameRequest = frameVideo.requestVideoFrameCallback((_now, metadata) => {
          if (!finish(readFrameMetadata(video, metadata))) requestNext();
        });
        return;
      }
      const check = () => {
        if (!finish(readFrameMetadata(video)) && !settled) {
          window.requestAnimationFrame(check);
        }
      };
      window.requestAnimationFrame(check);
    };

    requestNext();
  });

const seekToBeginning = async (video: HTMLVideoElement): Promise<void> => {
  if (video.currentTime !== 0) {
    const seeked = waitForVideoEvent(video, "seeked");
    video.currentTime = 0;
    await withPreparationWatchdog(seeked, "playback");
  }
};

/**
 * Establishes the frame that READY promises to retain. The seek, decode, and
 * presentation all happen before the pause; pausing and then seeking again
 * would invalidate the exact frame used to establish readiness.
 */
const settlePreparedStartingFrame = async (
  video: HTMLVideoElement,
  debug?: PreparedSurfaceDebug,
): Promise<void> => {
  await seekToBeginning(video);
  debug?.("PREPARED_FRAME_PLAY_REQUESTED");
  await withPreparationWatchdog(
    Promise.resolve(video.play()),
    "presented-frame",
  );
  debug?.("PREPARED_FRAME_PLAY_RESOLVED");
  await waitForPresentedFrame(video, debug);
  video.pause();
};

const resolveSurfaceSource = async (
  source: string,
): Promise<{ source?: string; sourceKind: "cache" | "local" | "remote" }> => {
  const localAssetId = parseLocalVideoFileAssetId(source);
  if (localAssetId) {
    const lease = acquireLocalVideoFileUrl(localAssetId);
    try {
      const localSource = await lease.url;
      return localSource && isPlayableMediaSource(localSource)
        ? { source: localSource, sourceKind: "local" }
        : { sourceKind: "local" };
    } finally {
      lease.release();
    }
  }
  if (isImmediateSurfaceSource(source)) {
    if (isHLSVideoSource(source)) return { sourceKind: "cache" };
    return {
      source,
      sourceKind: source.startsWith("media-cache://") ? "cache" : "local",
    };
  }
  if (!isPlayableMediaSource(source)) return { sourceKind: "remote" };
  if (!window.electronAPI?.getLocalMediaPath) {
    return isHLSVideoSource(source)
      ? { sourceKind: "remote" }
      : { source, sourceKind: "remote" };
  }
  try {
    const localSource = await window.electronAPI.getLocalMediaPath(source);
    if (!localSource) {
      return isHLSVideoSource(source)
        ? { sourceKind: "remote" }
        : { source, sourceKind: "remote" };
    }
    if (isHLSVideoSource(localSource) || !isPlayableMediaSource(localSource)) {
      return { sourceKind: "remote" };
    }
    return {
      source: localSource,
      sourceKind: localSource.startsWith("media-cache://") ? "cache" : "local",
    };
  } catch {
    return isHLSVideoSource(source) ? { sourceKind: "remote" } : { source, sourceKind: "remote" };
  }
};

const withPreparationWatchdog = async <T,>(
  promise: Promise<T>,
  stage: "metadata" | "playback" | "presented-frame",
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(
      () => reject(new Error(`${stage} preparation watchdog timeout`)),
      PREPARATION_WATCHDOG_MS,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });

const PreparedSurface = ({
  candidate,
  view,
  enabled,
  onStatusChange,
  route,
  role,
  outlineId,
  onReadyChange,
  onGeometryReadyChange,
  onFirstAdvancingFrameChange,
  onPreparationFailure,
  onSurfaceElement,
  onDiagnosticChange,
  stageRect,
}: {
  candidate: ElectronMediaSurfaceCandidate;
  view?: ElectronMediaSurfaceView;
  enabled: boolean;
  onStatusChange?: (status: MediaSurfaceStatus) => void;
  route: string;
  role: string;
  outlineId?: string | null;
  onReadyChange: (mediaKey: string, ready: boolean) => void;
  onGeometryReadyChange: (mediaKey: string, ready: boolean) => void;
  onFirstAdvancingFrameChange: (mediaKey: string, observed: boolean) => void;
  onPreparationFailure?: (mediaKey: string, reason: string) => void;
  onSurfaceElement: (mediaKey: string, element: HTMLDivElement | null) => void;
  onDiagnosticChange?: (diagnostic: SurfaceDiagnostic) => void;
  stageRect?: SurfaceRect;
}) => {
  const instanceIdRef = useRef(++nextPreparedSurfaceInstanceId);
  const mountedAtRef = useRef(performance.now());
  const videoRef = useRef<HTMLVideoElement>(null);
  const stateRef = useRef(initialPreparedVideoSurfaceState);
  const [state, setState] = useState(initialPreparedVideoSurfaceState);
  const [framePresentedReady, setFramePresentedReady] = useState(false);
  const [resolvedSource, setResolvedSource] = useState<string | undefined>(
    undefined,
  );
  const [sourceKind, setSourceKind] = useState<"cache" | "local" | "remote">(
    "remote",
  );
  const sourceKindRef = useRef<"cache" | "local" | "remote">("remote");
  const generationRef = useRef(0);
  const lifecycleGenerationRef = useRef(0);
  const lifecycleSourceRef = useRef(candidate.source);
  const lifecyclePhaseRef = useRef<MediaSurfaceLifecyclePhase>("candidate");
  const lifecycleRouteRef = useRef(route);
  const lifecycleRoleRef = useRef(role);
  const lifecycleOutlineIdRef = useRef(outlineId);
  lifecycleRouteRef.current = route;
  lifecycleRoleRef.current = role;
  lifecycleOutlineIdRef.current = outlineId;
  const geometryReadyRef = useRef(false);
  const playbackResumedRef = useRef(false);
  const advancingFrameRef = useRef(false);
  const frameMetadataRef = useRef<MediaSurfaceFrameMetadata | undefined>(
    undefined,
  );
  const preparationStartedAtRef = useRef<number | undefined>(undefined);
  const playingGenerationRef = useRef<number | undefined>(undefined);
  const playbackAttemptRef = useRef(0);
  const playbackInFlightRef = useRef(false);
  const resetInFlightRef = useRef(false);
  const lastCueGenerationRef = useRef<number | undefined>(undefined);
  const correctionStartedAtRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const surfaceElementRef = useRef<HTMLDivElement>(null);
  const resolvedSourceRef = useRef<string | undefined>(undefined);
  const frozenSourceRef = useRef<string | undefined>(undefined);
  const pendingSourceRef = useRef<string | undefined>(undefined);
  const shouldPlayRef = useRef(view?.shouldPlay);
  const viewRef = useRef(view);
  shouldPlayRef.current = view?.shouldPlay;
  viewRef.current = view;
  const onReadyChangeRef = useRef(onReadyChange);
  const onGeometryReadyChangeRef = useRef(onGeometryReadyChange);
  const onFirstAdvancingFrameChangeRef = useRef(onFirstAdvancingFrameChange);
  const onPreparationFailureRef = useRef(onPreparationFailure);
  const onDiagnosticChangeRef = useRef(onDiagnosticChange);
  const onStatusChangeRef = useRef(onStatusChange);
  onReadyChangeRef.current = onReadyChange;
  onGeometryReadyChangeRef.current = onGeometryReadyChange;
  onFirstAdvancingFrameChangeRef.current = onFirstAdvancingFrameChange;
  onPreparationFailureRef.current = onPreparationFailure;
  onDiagnosticChangeRef.current = onDiagnosticChange;
  onStatusChangeRef.current = onStatusChange;
  sourceKindRef.current = sourceKind;
  resolvedSourceRef.current = resolvedSource;

  const publishLifecycleStatus = useCallback(
    (
      phase: MediaSurfaceLifecyclePhase,
      extra: Partial<Pick<MediaSurfaceStatus, "geometryReady" | "advancingFrame" | "frame" | "error">> = {},
    ) => {
      lifecyclePhaseRef.current = phase;
      onStatusChangeRef.current?.({
        mediaKey: candidate.mediaKey,
        sourceIdentity: lifecycleSourceRef.current,
        route: lifecycleRouteRef.current,
        role: lifecycleRoleRef.current,
        outlineId: lifecycleOutlineIdRef.current,
        generation: lifecycleGenerationRef.current,
        phase,
        geometryReady: geometryReadyRef.current,
        playbackResumed: playbackResumedRef.current,
        advancingFrame: advancingFrameRef.current,
        frame: frameMetadataRef.current,
        timestamp: performance.now(),
        ...extra,
      });
      onDiagnosticChangeRef.current?.({
        mediaKey: candidate.mediaKey,
        source: lifecycleSourceRef.current,
        phase: stateRef.current.phase,
        sourceKind: sourceKindRef.current,
        surfaceState: surfaceStateForLifecycle(phase),
        lifecyclePhase: phase,
        lifecycleRoute: lifecycleRouteRef.current,
        lifecycleRole: lifecycleRoleRef.current,
        lifecycleOutlineId: lifecycleOutlineIdRef.current,
        lifecycleGeneration: lifecycleGenerationRef.current,
        lifecycleFrame: frameMetadataRef.current,
        playbackResumed: playbackResumedRef.current,
        error: extra.error,
      });
    },
    [candidate.mediaKey],
  );

  const debug = useCallback<PreparedSurfaceDebug>(
    (event, details = {}) => {
      if (!import.meta.env.DEV) return;
      const video = videoRef.current;
      const rect = video?.getBoundingClientRect();
      const styles = video ? window.getComputedStyle(video) : undefined;
      console.debug("[prepared-surface]", event, {
        instanceId: instanceIdRef.current,
        mediaKey: candidate.mediaKey,
        resolvedSource: resolvedSourceRef.current,
        mountMs: performance.now() - mountedAtRef.current,
        attached: Boolean(video?.isConnected),
        width: rect?.width ?? video?.clientWidth,
        height: rect?.height ?? video?.clientHeight,
        display: styles?.display,
        visibility: styles?.visibility,
        opacity: styles?.opacity,
        readyState: video?.readyState,
        networkState: video?.networkState,
        currentTime: video?.currentTime,
        paused: video?.paused,
        seeking: video?.seeking,
        buffered: video
          ? Array.from({ length: video.buffered.length }, (_, index) => [
              video.buffered.start(index),
              video.buffered.end(index),
            ])
          : [],
        generation: generationRef.current,
        ...details,
      });
    },
    [candidate.mediaKey],
  );

  const update = useCallback(
    (next: PreparedVideoSurfaceState) => {
      stateRef.current = next;
      if (mountedRef.current) setState(next);
      onDiagnosticChangeRef.current?.({
        mediaKey: candidate.mediaKey,
        source: resolvedSourceRef.current ?? candidate.source,
        phase: next.phase,
        sourceKind: sourceKindRef.current,
        surfaceState: surfaceStateForPhase(next.phase),
        error: next.error,
      });
    },
    [candidate.mediaKey, candidate.source],
  );

  const publishReady = useCallback(
    (extra: Partial<SurfaceDiagnostic> = {}) => {
      onDiagnosticChangeRef.current?.({
        mediaKey: candidate.mediaKey,
        source: resolvedSourceRef.current ?? candidate.source,
        phase: stateRef.current.phase,
        sourceKind: sourceKindRef.current,
        surfaceState: surfaceStateForPhase(stateRef.current.phase),
        ...extra,
      });
    },
    [candidate.mediaKey, candidate.source],
  );

  const prepare = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !resolvedSource || !enabled) return;
    if (isHLSVideoSource(resolvedSource)) {
      const message = "HLS source is not a finite prepared video";
      const failed = advancePreparedVideoSurface(
        stateRef.current,
        stateRef.current.generation,
        "error",
        message,
      );
      update(failed);
      onReadyChangeRef.current(candidate.mediaKey, false);
      onPreparationFailureRef.current?.(candidate.mediaKey, message);
      return;
    }
    const loading = beginPreparedVideoSurface(stateRef.current);
    generationRef.current = loading.generation;
    lifecycleGenerationRef.current = loading.generation;
    lifecycleSourceRef.current = resolvedSource;
    geometryReadyRef.current = false;
    playbackResumedRef.current = false;
    advancingFrameRef.current = false;
    frameMetadataRef.current = undefined;
    preparationStartedAtRef.current = performance.now();
    playingGenerationRef.current = undefined;
    playbackInFlightRef.current = false;
    onReadyChangeRef.current(candidate.mediaKey, false);
    setFramePresentedReady(false);
    onFirstAdvancingFrameChangeRef.current(candidate.mediaKey, false);
    publishLifecycleStatus("preparing");
    debug("PREPARE_START", { source: resolvedSource });
    update(loading);

    let stage: "metadata" | "playback" | "presented-frame" = "metadata";
    try {
      video.pause();
      video.currentTime = 0;
      if (
        !assignPlayableVideoSource(video, resolvedSource, {
          mediaKey: candidate.mediaKey,
          renderer: "electron-media-surface-pool",
          path: "PreparedSurface.prepare",
        })
      ) {
        throw new Error("opaque media source rejected");
      }
      video.load();
      await withPreparationWatchdog(
        waitForVideoEvent(video, "loadedmetadata"),
        "metadata",
      );
      if (stateRef.current.generation !== loading.generation) return;
      update(
        advancePreparedVideoSurface(loading, loading.generation, "preparing"),
      );
      stage = "presented-frame";
      await settlePreparedStartingFrame(video, debug);
      if (stateRef.current.generation !== loading.generation) {
        debug("GENERATION_INVALIDATED", {
          expected: loading.generation,
          actual: stateRef.current.generation,
        });
        return;
      }
      const ready = advancePreparedVideoSurface(
        stateRef.current,
        loading.generation,
        "ready",
      );
      update(ready);
      setFramePresentedReady(true);
      onReadyChangeRef.current(candidate.mediaKey, true);
      publishLifecycleStatus("ready-paused", { geometryReady: geometryReadyRef.current });
      publishReady({
        prepareToFrameReadyMs:
          performance.now() -
          (preparationStartedAtRef.current ?? performance.now()),
      });
      debug("READY");
    } catch (error) {
      if (stateRef.current.generation !== loading.generation) return;
      debug("PREPARE_FAILED", { stage, error: String(error) });
      const message = getPreparedVideoSurfaceErrorMessage(stage, error);
      onReadyChangeRef.current(candidate.mediaKey, false);
      publishLifecycleStatus("preparing", { error: message });
      setFramePresentedReady(false);
      onPreparationFailureRef.current?.(candidate.mediaKey, message);
      update(
        advancePreparedVideoSurface(
          stateRef.current,
          loading.generation,
          "error",
          message,
        ),
      );
    }
  }, [
    candidate.mediaKey,
    debug,
    enabled,
    publishReady,
    publishLifecycleStatus,
    resolvedSource,
    update,
  ]);

  const reset = useCallback(async () => {
    const video = videoRef.current;
    if (
      !video ||
      stateRef.current.phase === "disposed" ||
      resetInFlightRef.current
    ) {
      return;
    }
    resetInFlightRef.current = true;
    playbackAttemptRef.current += 1;
    const generation = stateRef.current.generation;
    update(
      advancePreparedVideoSurface(stateRef.current, generation, "resetting"),
    );
    publishLifecycleStatus("retiring/resetting");
    geometryReadyRef.current = false;
    playbackResumedRef.current = false;
    advancingFrameRef.current = false;
    frameMetadataRef.current = undefined;
    onFirstAdvancingFrameChange(candidate.mediaKey, false);
    setFramePresentedReady(false);
    onReadyChange(candidate.mediaKey, false);
    playingGenerationRef.current = undefined;
    playbackInFlightRef.current = false;
    correctionStartedAtRef.current = undefined;
    preparationStartedAtRef.current = performance.now();
    video.pause();
    try {
      await settlePreparedStartingFrame(video, debug);
      if (stateRef.current.generation !== generation) return;
      update(
        advancePreparedVideoSurface(stateRef.current, generation, "ready"),
      );
      setFramePresentedReady(true);
      onReadyChange(candidate.mediaKey, true);
      publishLifecycleStatus("ready-paused");
      publishReady({
        prepareToFrameReadyMs:
          performance.now() -
          (preparationStartedAtRef.current ?? performance.now()),
      });
    } catch (error) {
      if (stateRef.current.generation !== generation) return;
      const message = getPreparedVideoSurfaceErrorMessage(
        "presented-frame",
        error,
      );
      update(
        advancePreparedVideoSurface(
          stateRef.current,
          generation,
          "error",
          message,
        ),
      );
      onReadyChange(candidate.mediaKey, false);
      onPreparationFailure?.(candidate.mediaKey, message);
    } finally {
      resetInFlightRef.current = false;
    }
  }, [
    candidate.mediaKey,
    debug,
    onFirstAdvancingFrameChange,
    onPreparationFailure,
    onReadyChange,
    publishReady,
    publishLifecycleStatus,
    update,
  ]);

  const play = useCallback(async () => {
    const video = videoRef.current;
    const phase = stateRef.current.phase;
    if (
      !video ||
      (phase !== "ready" && phase !== "playing") ||
      !shouldPlayRef.current
    ) {
      return;
    }
    const cue = viewRef.current?.playback;
    if (cue?.mediaKey === candidate.mediaKey && cue.paused) return;
    if (
      playingGenerationRef.current === stateRef.current.generation &&
      (!video.paused || playbackInFlightRef.current)
    ) {
      return;
    }
    const generation = stateRef.current.generation;
    const playbackAttempt = ++playbackAttemptRef.current;
    playbackInFlightRef.current = true;
    const stateBeforeSend: SurfaceDiagnostic["sendStateBeforeRequest"] =
      phase === "ready" ? "READY" : "PREPARING";
    const sendRequestedAt = performance.now();
    const sendBufferedRanges: Array<[number, number]> = Array.from(
      { length: video.buffered.length },
      (_, index) => [video.buffered.start(index), video.buffered.end(index)],
    );
    playingGenerationRef.current = generation;
    frozenSourceRef.current = resolvedSourceRef.current;
    pendingSourceRef.current = undefined;
    update(
      advancePreparedVideoSurface(stateRef.current, generation, "playing"),
    );
    publishLifecycleStatus("activation-requested");
    onFirstAdvancingFrameChange(candidate.mediaKey, false);
    try {
      publishReady({
        sendRequestTimestamp: sendRequestedAt,
        sendTimestamp: sendRequestedAt,
        wasReadyBeforeSend: stateBeforeSend === "READY",
        sendStateBeforeRequest: stateBeforeSend,
        sendCurrentTime: video.currentTime,
        sendReadyState: video.readyState,
        sendPaused: video.paused,
        sendSeeking: video.seeking,
        sendBufferedRanges,
      });
      debug("PLAY_REQUESTED", { mode: "live", sendRequestedAt });
      const playCalledAt = performance.now();
      publishReady({
        playCalledTimestamp: playCalledAt,
        playRequestTimestamp: playCalledAt,
      });
      await withPreparationWatchdog(
        Promise.resolve(video.play()),
        "presented-frame",
      );
      if (
        playbackAttemptRef.current !== playbackAttempt ||
        !shouldPlayRef.current ||
        (viewRef.current?.playback?.mediaKey === candidate.mediaKey &&
          viewRef.current.playback.paused)
      ) {
        playbackInFlightRef.current = false;
        return;
      }
      const playResolvedAt = performance.now();
      playbackResumedRef.current = true;
      publishLifecycleStatus("activation-requested", {
        geometryReady: geometryReadyRef.current,
      });
      publishReady({
        playResolvedTimestamp: playResolvedAt,
        sendToPlayRequestMs: playCalledAt - sendRequestedAt,
        sendToPlayResolvedMs: playResolvedAt - sendRequestedAt,
      });
      debug("PLAY_RESOLVED", { mode: "live", playResolvedAt });
      const frame = await waitForAdvancingFrame(video, debug);
      if (
        stateRef.current.generation !== generation ||
        playbackAttemptRef.current !== playbackAttempt ||
        !shouldPlayRef.current ||
        (viewRef.current?.playback?.mediaKey === candidate.mediaKey &&
          viewRef.current.playback.paused)
      ) {
        playbackInFlightRef.current = false;
        return;
      }
      playbackInFlightRef.current = false;
      const firstAdvancingFrameAt = performance.now();
      const firstAdvancingFrameWallClockAt = serverNow();
      frameMetadataRef.current = frame;
      advancingFrameRef.current = true;
      onFirstAdvancingFrameChange(candidate.mediaKey, true);
      publishReady({
        firstAdvancingFrameTimestamp: firstAdvancingFrameAt,
        firstAdvancingFrameWallClockTimestamp: firstAdvancingFrameWallClockAt,
        sendToFirstAdvancingFrameMs: firstAdvancingFrameAt - sendRequestedAt,
      });
      debug("FIRST_ADVANCING_FRAME", { mode: "live", firstAdvancingFrameAt });
      if (geometryReadyRef.current) publishLifecycleStatus("active-playing", { frame });
      publishReady({
        lastUsedAt: Date.now(),
      });
    } catch (error) {
      playbackInFlightRef.current = false;
      if (stateRef.current.generation !== generation) return;
      debug("PLAY_REJECTED", { mode: "live", error: String(error) });
      const message = getPreparedVideoSurfaceErrorMessage("playback", error);
      playingGenerationRef.current = undefined;
      update(
        advancePreparedVideoSurface(
          stateRef.current,
          generation,
          "error",
          message,
        ),
      );
      onFirstAdvancingFrameChange(candidate.mediaKey, false);
      onPreparationFailure?.(candidate.mediaKey, message);
    }
  }, [
    candidate.mediaKey,
    debug,
    onPreparationFailure,
    onFirstAdvancingFrameChange,
    publishReady,
    publishLifecycleStatus,
    update,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    if (frozenSourceRef.current && shouldPlayRef.current) {
      pendingSourceRef.current = candidate.source;
      debug("SOURCE_DEFERRED_WHILE_ACTIVE", {
        candidateSource: candidate.source,
        activeSource: frozenSourceRef.current,
      });
      return () => {
        active = false;
      };
    }
    publishLifecycleStatus("candidate");
    const loading = beginPreparedVideoSurface(stateRef.current);
    generationRef.current = loading.generation;
    lifecycleGenerationRef.current = loading.generation;
    lifecycleSourceRef.current = candidate.source;
    lifecyclePhaseRef.current = "preparing";
    geometryReadyRef.current = false;
    playbackResumedRef.current = false;
    advancingFrameRef.current = false;
    frameMetadataRef.current = undefined;
    stateRef.current = loading;
    setState(loading);
    onReadyChangeRef.current(candidate.mediaKey, false);
    onGeometryReadyChangeRef.current(candidate.mediaKey, false);
    setFramePresentedReady(false);
    onFirstAdvancingFrameChangeRef.current(candidate.mediaKey, false);
    publishLifecycleStatus("preparing");
    playingGenerationRef.current = undefined;
    setResolvedSource(undefined);
    void resolveSurfaceSource(candidate.source).then((result) => {
      if (!active) return;
      debug("SOURCE_CHANGE", {
        source: candidate.source,
        resolvedSource: result.source,
        sourceKind: result.sourceKind,
      });
      setSourceKind(result.sourceKind);
      lifecycleSourceRef.current = result.source ?? candidate.source;
      setResolvedSource(result.source);
      if (!result.source) {
        const error = isHLSVideoSource(candidate.source)
          ? "HLS source is not a finite prepared video"
          : "local/cache source unavailable";
        const failed = advancePreparedVideoSurface(
          stateRef.current,
          stateRef.current.generation,
          "error",
          error,
        );
        stateRef.current = failed;
        if (mountedRef.current) setState(failed);
        onDiagnosticChangeRef.current?.({
          mediaKey: candidate.mediaKey,
          source: candidate.source,
          phase: failed.phase,
          sourceKind: result.sourceKind,
          error,
        });
        onPreparationFailureRef.current?.(candidate.mediaKey, error);
        publishLifecycleStatus("preparing", { error });
      }
    });
    return () => {
      active = false;
    };
  }, [
    candidate.mediaKey,
    candidate.source,
    debug,
    publishLifecycleStatus,
  ]);

  useEffect(() => {
    if (!enabled || !resolvedSource) return;
    void prepare();
  }, [enabled, prepare, resolvedSource]);

  useEffect(() => {
    if (view?.shouldPlay || !frozenSourceRef.current) return;
    const pendingSource = pendingSourceRef.current;
    frozenSourceRef.current = undefined;
    pendingSourceRef.current = undefined;
    if (!pendingSource) return;
    let active = true;
    void resolveSurfaceSource(pendingSource).then((result) => {
      if (!active) return;
      setSourceKind(result.sourceKind);
      setResolvedSource(result.source);
    });
    return () => {
      active = false;
    };
  }, [candidate.source, view?.shouldPlay]);

  // Outline selection scopes diagnostics and candidate discovery, but it does
  // not change the media identity or the prepared DOM surface. Re-emit the
  // current lifecycle under the new scope instead of forcing a re-prepare.
  useEffect(() => {
    const phase = lifecyclePhaseRef.current;
    if (!enabled || phase === "candidate" || phase === "disposed") return;
    publishLifecycleStatus(phase);
  }, [enabled, outlineId, publishLifecycleStatus]);

  const hasView = view !== undefined;

  useLayoutEffect(() => {
    const surface = surfaceElementRef.current;
    const video = videoRef.current;
    const surfaceRect = snapshotRect(surface);
    const videoRect = snapshotRect(video);
    const surfaceStyles = surface
      ? window.getComputedStyle(surface)
      : undefined;
    const videoStyles = video ? window.getComputedStyle(video) : undefined;
    const actualCurrentSrc = video?.currentSrc || video?.src || undefined;
    const canonicalSourceMatch = areEquivalentMediaSources(
      resolvedSource,
      actualCurrentSrc,
    );
    const sourceUnchanged = Boolean(
      !resolvedSource || !actualCurrentSrc || canonicalSourceMatch,
    );
    const stageHasLayout = Boolean(stageRect?.width && stageRect?.height);
    const surfaceMatchesStage =
      !stageHasLayout ||
      (Boolean(surfaceRect?.width && surfaceRect?.height) &&
        Math.abs((surfaceRect?.width ?? 0) - (stageRect?.width ?? 0)) <= 1 &&
        Math.abs((surfaceRect?.height ?? 0) - (stageRect?.height ?? 0)) <= 1);
    const hasObservableLayout = Boolean(
      surfaceRect?.width ||
        surfaceRect?.height ||
        videoRect?.width ||
        videoRect?.height ||
        video?.videoWidth ||
        video?.videoHeight,
    );
    const connected = Boolean(surface?.isConnected && video?.isConnected);
    const hidden = Boolean(
      surfaceStyles?.display === "none" ||
        surfaceStyles?.visibility === "hidden" ||
        videoStyles?.display === "none" ||
        videoStyles?.visibility === "hidden",
    );
    const surfaceSizeReady = Boolean(
      !hasObservableLayout ||
        (surfaceRect?.width && surfaceRect?.height),
    );
    const videoSizeReady = Boolean(
      !hasObservableLayout || (videoRect?.width && videoRect?.height),
    );
    const geometryReady = Boolean(
      connected &&
        !hidden &&
        sourceUnchanged &&
        framePresentedReady &&
        surfaceMatchesStage &&
        surfaceSizeReady &&
        videoSizeReady,
    );
    geometryReadyRef.current = geometryReady;
    const geometryReason = geometryReady
      ? undefined
      : !connected
        ? "disconnected"
        : hidden
          ? "hidden"
          : !sourceUnchanged
            ? "source-mismatch"
            : !framePresentedReady
              ? "no-presented-frame"
              : !surfaceSizeReady
                ? "surface-size-zero"
                : !videoSizeReady
                  ? "video-size-zero"
                  : !surfaceMatchesStage
                    ? "stage-size-mismatch"
                    : undefined;
    onGeometryReadyChange(candidate.mediaKey, geometryReady);
    if (advancingFrameRef.current) {
      publishLifecycleStatus(
        geometryReady ? "active-playing" : "activation-requested",
        { geometryReady },
      );
    } else if (
      framePresentedReady &&
      lifecyclePhaseRef.current !== "activation-requested" &&
      lifecyclePhaseRef.current !== "active-playing" &&
      lifecyclePhaseRef.current !== "retiring/resetting"
    ) {
      publishLifecycleStatus("ready-paused", { geometryReady });
    }
    onDiagnosticChange?.({
      mediaKey: candidate.mediaKey,
      source: resolvedSource ?? candidate.source,
      phase: stateRef.current.phase,
      sourceKind,
      geometryReady,
      geometryReason,
      framePresentedReady,
      expectedSource: resolvedSource,
      actualCurrentSrc,
      canonicalSourceMatch,
      surfaceRect,
      videoRect,
      intrinsicVideoSize: {
        width: video?.videoWidth ?? 0,
        height: video?.videoHeight ?? 0,
      },
      objectFit: videoStyles?.objectFit,
      sourceUnchanged,
    });
  }, [
    candidate.mediaKey,
    candidate.source,
    onDiagnosticChange,
    onGeometryReadyChange,
    publishLifecycleStatus,
    resolvedSource,
    sourceKind,
    stageRect,
    state.phase,
    framePresentedReady,
    view?.videoBox,
  ]);

  useLayoutEffect(() => {
    if (!enabled || !view?.shouldPlay) {
      if (
        stateRef.current.phase === "playing" ||
        (stateRef.current.phase === "error" && hasView)
      ) {
        void reset();
      }
      return;
    }
    if (stateRef.current.phase === "ready") {
      const cue = view?.playback;
      if (cue?.mediaKey === candidate.mediaKey && cue.paused) return;
      if (cue?.mediaKey === candidate.mediaKey) {
        lastCueGenerationRef.current = cue.generation;
      }
      void play();
    }
  }, [
    candidate.mediaKey,
    enabled,
    hasView,
    play,
    reset,
    state.phase,
    view?.playback,
    view?.shouldPlay,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    const cue = view?.playback;
    if (!video || !cue || cue.mediaKey !== candidate.mediaKey) return;
    if (lastCueGenerationRef.current === cue.generation) return;
    lastCueGenerationRef.current = cue.generation;
    // A READY surface already owns the retained starting frame. Applying a
    // synchronization seek here would invalidate that frame between the
    // operator request and the transition; the playback-rate correction loop
    // can reconcile a later cue without blocking the handoff.
    if (cue.applySeek && stateRef.current.phase === "idle") {
      video.currentTime = resolveVideoPlaybackPosition(
        cue,
        Number.isFinite(video.duration) ? video.duration : undefined,
      );
    }
    if (cue.paused) {
      video.pause();
      correctionStartedAtRef.current = undefined;
      return;
    }
    if (
      view.shouldPlay &&
      video.paused &&
      stateRef.current.phase === "playing"
    ) {
      void play();
    }
  }, [candidate.mediaKey, play, view?.playback, view?.shouldPlay]);

  useEffect(() => {
    if (!view?.shouldPlay || state.phase !== "playing") return;
    const video = videoRef.current;
    if (!video) return;
    const intervalId = window.setInterval(() => {
      const cue = view.playback;
      if (
        !cue ||
        cue.mediaKey !== candidate.mediaKey ||
        cue.paused ||
        video.paused
      ) {
        video.playbackRate = 1;
        correctionStartedAtRef.current = undefined;
        return;
      }
      const drift = resolveVideoCueDrift(
        cue,
        video.currentTime,
        Number.isFinite(video.duration) ? video.duration : undefined,
      );
      let correction = resolveVideoCueCorrection(drift, video.playbackRate);
      if (
        correction.correction === "speed up" ||
        correction.correction === "slow down"
      ) {
        const now = Date.now();
        const startedAt = correctionStartedAtRef.current ?? now;
        correctionStartedAtRef.current = startedAt;
        if (now - startedAt >= VIDEO_CUE_RATE_CORRECTION_MAX_DURATION_MS) {
          correction = {
            correction: "hard seek",
            playbackRate: 1,
            shouldSeek: true,
          };
        }
      } else {
        correctionStartedAtRef.current = undefined;
      }
      video.playbackRate = correction.playbackRate;
      if (correction.shouldSeek) {
        video.currentTime = resolveVideoPlaybackPosition(
          cue,
          Number.isFinite(video.duration) ? video.duration : undefined,
        );
      }
    }, 500);
    return () => window.clearInterval(intervalId);
  }, [candidate.mediaKey, state.phase, view]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = view?.volume ?? 1;
  }, [view?.volume]);

  useEffect(() => {
    const video = videoRef.current;
    debug("MOUNT");
    return () => {
      debug("UNMOUNT");
      mountedRef.current = false;
      publishLifecycleStatus("disposed");
      onReadyChange(candidate.mediaKey, false);
      onGeometryReadyChange(candidate.mediaKey, false);
      onFirstAdvancingFrameChange(candidate.mediaKey, false);
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      stateRef.current = disposePreparedVideoSurface(stateRef.current);
    };
  }, [
    candidate.mediaKey,
    debug,
    onFirstAdvancingFrameChange,
    onGeometryReadyChange,
    onReadyChange,
    publishLifecycleStatus,
  ]);

  const opacity = view?.opacity;
  const videoBox = view?.videoBox;
  const surfaceRef = useCallback(
    (element: HTMLDivElement | null) => {
      surfaceElementRef.current = element;
      onSurfaceElement(candidate.mediaKey, element);
    },
    [candidate.mediaKey, onSurfaceElement],
  );
  return (
    <div
      ref={surfaceRef}
      className="pointer-events-none absolute inset-0"
      data-testid={`electron-media-surface-${candidate.mediaKey}`}
      data-media-key={candidate.mediaKey}
      data-prepared-state={state.phase}
      data-media-lifecycle={lifecyclePhaseRef.current}
      data-source-kind={sourceKind}
      style={{
        opacity: view ? opacity : 0,
        zIndex: view?.zIndex ?? 0,
        willChange: "opacity",
      }}
    >
      <video
        ref={videoRef}
        muted={view?.muted ?? true}
        playsInline
        preload="auto"
        loop
        data-testid={`electron-media-surface-video-${candidate.mediaKey}`}
        className={`absolute inset-0 h-full w-full ${
          videoBox?.shouldKeepAspectRatio ? "object-contain" : "object-cover"
        }`}
        style={{
          filter: videoBox?.brightness
            ? `brightness(${videoBox.brightness}%)`
            : undefined,
        }}
      />
    </div>
  );
};

const ElectronMediaSurfacePool = ({
  enabled,
  candidates,
  candidateDiagnostics,
  views,
  onStatusChange,
  route,
  role,
  outlineId,
  onReadyChange = NOOP,
  onGeometryReadyChange = NOOP,
  onFirstAdvancingFrameChange = NOOP,
  onPreparationFailure,
  onSurfaceElement = NOOP,
  onDiagnosticChange,
  transitionStart,
  transitionVisible,
  transitionComplete,
  lastSendPath,
  lastMediaKey,
  posterShown,
  outputId,
  windowRole,
  discovery,
  poolCapacity,
}: ElectronMediaSurfacePoolProps) => {
  const lifecycleRoute = route ?? "display-window";
  const lifecycleRole = role ?? windowRole ?? "output";
  const [diagnostics, setDiagnostics] = useState<
    Record<string, SurfaceDiagnostic>
  >({});
  const [rendererMetrics, setRendererMetrics] = useState<
    PreparedVideoMetrics | undefined
  >(undefined);
  const [mountedSurfaceKeys, setMountedSurfaceKeys] = useState<string[]>([]);
  const poolElementRef = useRef<HTMLDivElement>(null);
  const [stageRect, setStageRect] = useState<SurfaceRect | undefined>();
  const latestDiagnosticsRef = useRef<
    ReturnType<typeof summarizeElectronMediaSurfaceDiagnostics> | undefined
  >(undefined);
  const previousKeysRef = useRef<string[]>([]);
  const previousCandidatesRef = useRef(
    new Map<string, ElectronMediaSurfaceCandidate>(),
  );
  const previousDiscoveryRef = useRef<ElectronMediaDiscovery | undefined>(
    undefined,
  );
  const evictionHistoryRef = useRef<string[]>([]);
  const candidateKeys = useMemo(
    () => candidates.map((candidate) => candidate.mediaKey),
    [candidates],
  );
  const candidateKeySignature = candidateKeys.join("\u0000");
  const candidateSignature = useMemo(
    () =>
      candidates
        .map((candidate) => `${candidate.mediaKey}\u0000${candidate.source}`)
        .join("\u0001"),
    [candidates],
  );
  const candidateKeysRef = useRef(candidateKeys);
  const candidatesRef = useRef(candidates);
  candidateKeysRef.current = candidateKeys;
  candidatesRef.current = candidates;
  const viewsByKey = useMemo(
    () => new Map(views.map((view) => [view.mediaKey, view])),
    [views],
  );
  const mountedKeySet = useMemo(
    () => new Set(mountedSurfaceKeys),
    [mountedSurfaceKeys],
  );

  useLayoutEffect(() => {
    const element = poolElementRef.current;
    if (!element) return;
    const updateRect = () => {
      const next = snapshotRect(element);
      setStageRect((current) => {
        if (
          current?.x === next?.x &&
          current?.y === next?.y &&
          current?.width === next?.width &&
          current?.height === next?.height
        ) {
          return current;
        }
        return next;
      });
    };
    updateRect();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateRect);
    observer.observe(element);
    return () => observer.disconnect();
  }, [candidateKeySignature]);
  const handleDiagnosticChange = useCallback(
    (diagnostic: SurfaceDiagnostic) => {
      const withRenderer = {
        ...diagnostic,
        renderer: rendererForWindowRole(windowRole),
      };
      setDiagnostics((current) => ({
        ...current,
        [withRenderer.mediaKey]: {
          ...current[withRenderer.mediaKey],
          ...withRenderer,
        },
      }));
      onDiagnosticChange?.(withRenderer);
    },
    [onDiagnosticChange, windowRole],
  );

  const handleSurfaceElement = useCallback(
    (mediaKey: string, element: HTMLDivElement | null) => {
      onSurfaceElement(mediaKey, element);
      setMountedSurfaceKeys((current) => {
        const next = new Set(current);
        if (element) next.add(mediaKey);
        else next.delete(mediaKey);
        const nextKeys = [...next].sort();
        return current.length === nextKeys.length &&
          current.every((key, index) => key === nextKeys[index])
          ? current
          : nextKeys;
      });
    },
    [onSurfaceElement],
  );

  useEffect(() => {
    const nextKeys = new Set(candidateKeysRef.current);
    const previousCandidates = previousCandidatesRef.current;
    const evicted = previousKeysRef.current.filter(
      (mediaKey) => !nextKeys.has(mediaKey),
    );
    previousKeysRef.current = candidateKeysRef.current;
    if (evicted.length > 0) {
      const detailsByKey = new Map(
        (candidateDiagnostics ?? []).map((detail) => [detail.mediaKey, detail]),
      );
      const outlineChanged =
        previousDiscoveryRef.current?.outlineId !== discovery?.outlineId;
      evictionHistoryRef.current = [
        ...evictionHistoryRef.current,
        ...evicted.map((mediaKey) => {
          const detail = detailsByKey.get(mediaKey);
          const previous = previousCandidates.get(mediaKey);
          const reason = outlineChanged
            ? "outline switched"
            : !detail
              ? "service removed"
            : detail?.status === "eligible" || detail?.status === "pending-cache"
              ? "resource-budget eviction"
              : previous?.source !== detail?.resolvedSource
                ? "media identity/source changed"
                : "service removed";
          return `${mediaKey} (${reason})`;
        }),
      ].slice(-64);
    }
    previousDiscoveryRef.current = discovery;
    previousCandidatesRef.current = new Map(
      candidatesRef.current.map((candidate) => [candidate.mediaKey, candidate]),
    );
    setDiagnostics((current) => {
      const candidateSet = new Set(candidateKeysRef.current);
      const next = Object.fromEntries(
        Object.entries(current).filter(([mediaKey]) =>
          candidateSet.has(mediaKey),
        ),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [candidateDiagnostics, candidateKeySignature, discovery]);

  useEffect(() => {
    if (!transitionStart) return;
    setDiagnostics((current) => {
      const diagnostic = current[transitionStart.mediaKey] ?? {
        mediaKey: transitionStart.mediaKey,
        source: "",
        phase: "idle" as const,
        sourceKind: "remote" as const,
      };
      return {
        ...current,
        [transitionStart.mediaKey]: {
          ...diagnostic,
          controllerActionTimestamp:
            transitionStart.controllerActionTimestamp ??
            diagnostic.controllerActionTimestamp,
          transitionStartTimestamp: transitionStart.timestamp,
          sendToTransitionStartMs:
            diagnostic.sendRequestTimestamp == null
              ? undefined
              : transitionStart.timestamp - diagnostic.sendRequestTimestamp,
        },
      };
    });
  }, [transitionStart]);

  useEffect(() => {
    if (!transitionVisible) return;
    setDiagnostics((current) => {
      const diagnostic = current[transitionVisible.mediaKey] ?? {
        mediaKey: transitionVisible.mediaKey,
        source: "",
        phase: "idle" as const,
        sourceKind: "remote" as const,
      };
      const controllerActionTimestamp =
        transitionVisible.controllerActionTimestamp ??
        diagnostic.controllerActionTimestamp;
      return {
        ...current,
        [transitionVisible.mediaKey]: {
          ...diagnostic,
          controllerActionTimestamp,
          firstVisibleFrameTimestamp: transitionVisible.timestamp,
          firstVisibleFrameWallClockTimestamp:
            transitionVisible.wallClockTimestamp,
          controllerToFirstVisibleFrameMs:
            controllerActionTimestamp == null
              ? undefined
              : transitionVisible.wallClockTimestamp - controllerActionTimestamp,
        },
      };
    });
  }, [transitionVisible]);

  useEffect(() => {
    if (!transitionComplete) return;
    setDiagnostics((current) => {
      const diagnostic = current[transitionComplete.mediaKey] ?? {
        mediaKey: transitionComplete.mediaKey,
        source: "",
        phase: "idle" as const,
        sourceKind: "remote" as const,
      };
      return {
        ...current,
        [transitionComplete.mediaKey]: {
          ...diagnostic,
          transitionCompleteTimestamp: transitionComplete.timestamp,
        },
      };
    });
  }, [transitionComplete]);

  useEffect(() => {
    const api = window.electronAPI as
      | (NonNullable<typeof window.electronAPI> & {
          getPreparedVideoMetrics?: () => Promise<PreparedVideoMetrics>;
        })
      | undefined;
    const getMetrics = api?.getPreparedVideoMetrics;
    if (!enabled || !api || !getMetrics) return;
    let active = true;
    const updateMetrics = async () => {
      try {
        const isDev = await api.isDev();
        if (!isDev || !active) return;
        const result = await getMetrics();
        if (active && result) setRendererMetrics(result);
      } catch {
        // Metrics are development-only diagnostics and never affect playback.
      }
    };
    void updateMetrics();
    const intervalId = window.setInterval(() => void updateMetrics(), 2000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !windowRole) return;
    const currentCandidates = candidatesRef.current;
    const details =
      candidateDiagnostics ??
      currentCandidates.map((candidate) => ({
        mediaKey: candidate.mediaKey,
        originalSource: candidate.originalSource ?? candidate.source,
        resolvedSource: candidate.source,
        sourceKind: candidate.sourceKind ?? ("unknown" as const),
        status: "eligible" as const,
        cacheStatus:
          candidate.sourceKind === "cache"
            ? ("cached" as const)
            : ("not-required" as const),
        eligible: true,
        reason: candidate.reason ?? "selected for preparation",
        itemId: candidate.itemId,
        itemName: candidate.itemName,
        itemIndex: candidate.itemIndex,
        isCurrentItem:
          candidate.itemId != null &&
          candidate.itemId === discovery?.currentItemId,
        }));
    const candidateByKey = new Map(
      currentCandidates.map((candidate) => [candidate.mediaKey, candidate]),
    );
    const detailsWithSurfaceState = details.map((detail) => {
      const candidate = candidateByKey.get(detail.mediaKey);
      const surface = diagnostics[detail.mediaKey];
      return {
        ...detail,
        priority: candidate?.priority,
        protected: candidate?.protected,
        surfaceState: surface?.surfaceState,
      };
    });
    const surfaceDiagnostics = currentCandidates
      .filter((candidate) => mountedKeySet.has(candidate.mediaKey))
      .map((candidate, index) => {
        const diagnostic = diagnostics[candidate.mediaKey];
        return {
          mediaKey: candidate.mediaKey,
          source: diagnostic?.source || candidate.source,
          phase: diagnostic?.phase ?? ("idle" as const),
          sourceKind: diagnostic?.sourceKind ?? ("remote" as const),
          renderer: diagnostic?.renderer ?? rendererForWindowRole(windowRole),
          geometryReady: diagnostic?.geometryReady,
          geometryReason: diagnostic?.geometryReason,
          framePresentedReady: diagnostic?.framePresentedReady,
          expectedSource: diagnostic?.expectedSource,
          actualCurrentSrc: diagnostic?.actualCurrentSrc,
          canonicalSourceMatch: diagnostic?.canonicalSourceMatch,
          surfaceRect: diagnostic?.surfaceRect,
          videoRect: diagnostic?.videoRect,
          intrinsicVideoSize: diagnostic?.intrinsicVideoSize,
          objectFit: diagnostic?.objectFit,
          sourceUnchanged: diagnostic?.sourceUnchanged,
          priority: diagnostic?.priority ?? candidate.priority ?? index,
          protected: diagnostic?.protected ?? candidate.protected,
          prepareToFrameReadyMs: diagnostic?.prepareToFrameReadyMs,
          surfaceState: diagnostic?.surfaceState,
          lifecyclePhase: diagnostic?.lifecyclePhase,
          lifecycleRoute: diagnostic?.lifecycleRoute,
          lifecycleRole: diagnostic?.lifecycleRole,
          lifecycleOutlineId: diagnostic?.lifecycleOutlineId,
          lifecycleGeneration: diagnostic?.lifecycleGeneration,
          lifecycleFrame: diagnostic?.lifecycleFrame,
          playbackResumed: diagnostic?.playbackResumed,
          sendStateBeforeRequest: diagnostic?.sendStateBeforeRequest,
          sendCurrentTime: diagnostic?.sendCurrentTime,
          sendReadyState: diagnostic?.sendReadyState,
          sendPaused: diagnostic?.sendPaused,
          sendSeeking: diagnostic?.sendSeeking,
          sendBufferedRanges: diagnostic?.sendBufferedRanges,
          sendRequestTimestamp: diagnostic?.sendRequestTimestamp,
          sendTimestamp: diagnostic?.sendTimestamp,
          wasReadyBeforeSend: diagnostic?.wasReadyBeforeSend,
          playCalledTimestamp: diagnostic?.playCalledTimestamp,
          playRequestTimestamp: diagnostic?.playRequestTimestamp,
          playResolvedTimestamp: diagnostic?.playResolvedTimestamp,
          transitionStartTimestamp: diagnostic?.transitionStartTimestamp,
          firstAdvancingFrameTimestamp:
            diagnostic?.firstAdvancingFrameTimestamp,
          firstAdvancingFrameWallClockTimestamp:
            diagnostic?.firstAdvancingFrameWallClockTimestamp,
          controllerActionTimestamp: diagnostic?.controllerActionTimestamp,
          firstVisibleFrameTimestamp: diagnostic?.firstVisibleFrameTimestamp,
          firstVisibleFrameWallClockTimestamp:
            diagnostic?.firstVisibleFrameWallClockTimestamp,
          controllerToFirstVisibleFrameMs:
            diagnostic?.controllerToFirstVisibleFrameMs,
          controllerToFirstAdvancingFrameMs:
            diagnostic?.controllerActionTimestamp != null &&
            diagnostic?.firstAdvancingFrameWallClockTimestamp != null
              ? diagnostic.firstAdvancingFrameWallClockTimestamp -
                diagnostic.controllerActionTimestamp
              : undefined,
          transitionCompleteTimestamp: diagnostic?.transitionCompleteTimestamp,
          sendToTransitionStartMs: diagnostic?.sendToTransitionStartMs,
          sendToPlayRequestMs: diagnostic?.sendToPlayRequestMs,
          sendToPlayResolvedMs: diagnostic?.sendToPlayResolvedMs,
          sendToFirstAdvancingFrameMs:
            diagnostic?.sendToFirstAdvancingFrameMs,
          lastUsedAt: diagnostic?.lastUsedAt,
          error: diagnostic?.error,
        };
      });
    const value = summarizeElectronMediaSurfaceDiagnostics({
      outputId,
      windowRole,
      candidateCount: currentCandidates.length,
      discoveredCount: details.length,
      pendingCacheCount: details.filter(
        (detail) =>
          detail.cacheStatus === "pending" ||
          detail.cacheStatus === "cache-in-progress" ||
          detail.cacheStatus === "retry-scheduled",
      ).length,
      candidateDetails: detailsWithSurfaceState,
      evictions: evictionHistoryRef.current,
      surfaces: surfaceDiagnostics,
      renderPath: lastSendPath,
      lastSendPath,
      lastMediaKey,
      posterShown,
      rendererMetrics,
      discovery,
      finiteVideoCount:
        discovery?.uniqueFiniteVideoCount ??
        new Set(
          details
            .filter((detail) => detail.status !== "excluded")
            .map((detail) => detail.mediaKey),
        ).size,
      serviceItemCount: discovery?.itemCount,
      currentItemId: discovery?.currentItemId,
      currentItemVideoCount: new Set(
        details
          .filter(
            (detail) =>
              detail.isCurrentItem && detail.status !== "excluded",
          )
          .map((detail) => detail.mediaKey),
      ).size,
      currentItemReadyCount: new Set(
        surfaceDiagnostics
          .filter(
            (surface) =>
                details.find((detail) => detail.mediaKey === surface.mediaKey)
                ?.isCurrentItem &&
                (surface.phase === "ready" || surface.phase === "playing"),
          )
          .map((surface) => surface.mediaKey),
      ).size,
      poolCapacity,
    });
    latestDiagnosticsRef.current = value;
    (
      window as Window & { __wsMediaSurfacePoolDiagnostics?: unknown }
    ).__wsMediaSurfacePoolDiagnostics = value;
    publishElectronMediaSurfaceDiagnostics(value);
    return () => {
      const target = window as Window & {
        __wsMediaSurfacePoolDiagnostics?: unknown;
      };
      if (target.__wsMediaSurfacePoolDiagnostics === value) {
        delete target.__wsMediaSurfacePoolDiagnostics;
      }
    };
  }, [
    candidateSignature,
    candidateDiagnostics,
    diagnostics,
    enabled,
    lastMediaKey,
    lastSendPath,
    mountedKeySet,
    outputId,
    poolCapacity,
    posterShown,
    rendererMetrics,
    transitionComplete,
    transitionStart,
    windowRole,
    discovery,
  ]);

  useEffect(() => {
    if (!enabled || !windowRole) return;
    return subscribeToElectronMediaSurfaceDiagnostics(
      () => undefined,
      () => {
        if (latestDiagnosticsRef.current) {
          publishElectronMediaSurfaceDiagnostics(latestDiagnosticsRef.current);
        }
      },
    );
  }, [enabled, windowRole]);

  if (!enabled) return null;
  return (
    <div
      ref={poolElementRef}
      className="pointer-events-none absolute inset-0"
      data-testid="electron-media-surface-pool"
    >
      {candidates.map((candidate) => (
        <PreparedSurface
          key={`${lifecycleRoute}:${lifecycleRole}:${candidate.mediaKey}`}
          candidate={candidate}
          view={viewsByKey.get(candidate.mediaKey)}
          enabled={enabled}
          onStatusChange={onStatusChange}
          route={lifecycleRoute}
          role={lifecycleRole}
          outlineId={outlineId}
          onReadyChange={onReadyChange}
          onGeometryReadyChange={onGeometryReadyChange}
          onFirstAdvancingFrameChange={onFirstAdvancingFrameChange}
          onPreparationFailure={onPreparationFailure}
          onSurfaceElement={handleSurfaceElement}
          onDiagnosticChange={handleDiagnosticChange}
          stageRect={stageRect}
        />
      ))}
    </div>
  );
};

export default ElectronMediaSurfacePool;
