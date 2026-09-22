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
} from "../../utils/electronMediaSurfaceDiagnostics";
import {
  resolveVideoCueDrift,
  resolveVideoCueCorrection,
  resolveVideoPlaybackPosition,
  VIDEO_CUE_RATE_CORRECTION_MAX_DURATION_MS,
} from "../../utils/videoBackgroundPlayback";
import { isHLSVideoSource } from "../../utils/isInstantVideoSource";

type SurfaceDiagnostic = ElectronMediaSurfaceDiagnostic;

type ElectronMediaSurfacePoolProps = {
  enabled: boolean;
  candidates: ElectronMediaSurfaceCandidate[];
  candidateDiagnostics?: ElectronMediaSurfaceCandidateDiagnostic[];
  views: ElectronMediaSurfaceView[];
  onReadyChange: (mediaKey: string, ready: boolean) => void;
  onFirstAdvancingFrameChange: (mediaKey: string, observed: boolean) => void;
  onSurfaceElement: (mediaKey: string, element: HTMLDivElement | null) => void;
  onDiagnosticChange?: (diagnostic: SurfaceDiagnostic) => void;
  transitionStart?: { mediaKey: string; timestamp: number };
  transitionComplete?: { mediaKey: string; timestamp: number };
  lastSendPath?: "pool" | "fallback";
  lastMediaKey?: string;
  posterShown?: boolean;
  outputId?: string;
  windowRole?: string;
};

const PRESENTED_FRAME_TIMEOUT_MS = 5000;

let nextPreparedSurfaceInstanceId = 0;

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

const seekToBeginning = async (video: HTMLVideoElement): Promise<void> => {
  if (video.currentTime !== 0) {
    const seeked = waitForVideoEvent(video, "seeked");
    video.currentTime = 0;
    await seeked;
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
  await video.play();
  debug?.("PREPARED_FRAME_PLAY_RESOLVED");
  await waitForPresentedFrame(video, debug);
  video.pause();
};

const resolveSurfaceSource = async (
  source: string,
): Promise<{ source?: string; sourceKind: "cache" | "local" | "remote" }> => {
  if (isImmediateSurfaceSource(source)) {
    if (isHLSVideoSource(source)) return { sourceKind: "cache" };
    return {
      source,
      sourceKind: source.startsWith("media-cache://") ? "cache" : "local",
    };
  }
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
    if (isHLSVideoSource(localSource)) return { sourceKind: "cache" };
    return {
      source: localSource,
      sourceKind: localSource.startsWith("media-cache://") ? "cache" : "local",
    };
  } catch {
    return isHLSVideoSource(source)
      ? { sourceKind: "remote" }
      : { source, sourceKind: "remote" };
  }
};

const PreparedSurface = ({
  candidate,
  view,
  enabled,
  onReadyChange,
  onFirstAdvancingFrameChange,
  onSurfaceElement,
  onDiagnosticChange,
}: {
  candidate: ElectronMediaSurfaceCandidate;
  view?: ElectronMediaSurfaceView;
  enabled: boolean;
  onReadyChange: (mediaKey: string, ready: boolean) => void;
  onFirstAdvancingFrameChange: (mediaKey: string, observed: boolean) => void;
  onSurfaceElement: (mediaKey: string, element: HTMLDivElement | null) => void;
  onDiagnosticChange?: (diagnostic: SurfaceDiagnostic) => void;
}) => {
  const instanceIdRef = useRef(++nextPreparedSurfaceInstanceId);
  const mountedAtRef = useRef(performance.now());
  const videoRef = useRef<HTMLVideoElement>(null);
  const stateRef = useRef(initialPreparedVideoSurfaceState);
  const [state, setState] = useState(initialPreparedVideoSurfaceState);
  const [resolvedSource, setResolvedSource] = useState<string | undefined>(
    undefined,
  );
  const [sourceKind, setSourceKind] = useState<"cache" | "local" | "remote">(
    "remote",
  );
  const generationRef = useRef(0);
  const preparationStartedAtRef = useRef<number | undefined>(undefined);
  const playingGenerationRef = useRef<number | undefined>(undefined);
  const lastCueGenerationRef = useRef<number | undefined>(undefined);
  const correctionStartedAtRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const resolvedSourceRef = useRef<string | undefined>(undefined);
  resolvedSourceRef.current = resolvedSource;

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
      onDiagnosticChange?.({
        mediaKey: candidate.mediaKey,
        source: resolvedSource ?? candidate.source,
        phase: next.phase,
        sourceKind,
        surfaceState: surfaceStateForPhase(next.phase),
        error: next.error,
      });
    },
    [
      candidate.mediaKey,
      candidate.source,
      onDiagnosticChange,
      resolvedSource,
      sourceKind,
    ],
  );

  const publishReady = useCallback(
    (extra: Partial<SurfaceDiagnostic> = {}) => {
      onDiagnosticChange?.({
        mediaKey: candidate.mediaKey,
        source: resolvedSource ?? candidate.source,
        phase: stateRef.current.phase,
        sourceKind,
        surfaceState: surfaceStateForPhase(stateRef.current.phase),
        ...extra,
      });
    },
    [
      candidate.mediaKey,
      candidate.source,
      onDiagnosticChange,
      resolvedSource,
      sourceKind,
    ],
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
      onReadyChange(candidate.mediaKey, false);
      return;
    }
    const loading = beginPreparedVideoSurface(stateRef.current);
    generationRef.current = loading.generation;
    preparationStartedAtRef.current = performance.now();
    playingGenerationRef.current = undefined;
    onReadyChange(candidate.mediaKey, false);
    onFirstAdvancingFrameChange(candidate.mediaKey, false);
    debug("PREPARE_START", { source: resolvedSource });
    update(loading);

    let stage: "metadata" | "playback" | "presented-frame" = "metadata";
    try {
      video.pause();
      video.currentTime = 0;
      video.src = resolvedSource;
      video.load();
      await waitForVideoEvent(video, "loadedmetadata");
      if (stateRef.current.generation !== loading.generation) return;
      update(
        advancePreparedVideoSurface(loading, loading.generation, "preparing"),
      );
      stage = "playback";
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
      onReadyChange(candidate.mediaKey, true);
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
      onReadyChange(candidate.mediaKey, false);
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
    onFirstAdvancingFrameChange,
    onReadyChange,
    publishReady,
    resolvedSource,
    update,
  ]);

  const reset = useCallback(async () => {
    const video = videoRef.current;
    if (!video || stateRef.current.phase === "disposed") return;
    const generation = stateRef.current.generation;
    update(
      advancePreparedVideoSurface(stateRef.current, generation, "resetting"),
    );
    onFirstAdvancingFrameChange(candidate.mediaKey, false);
    onReadyChange(candidate.mediaKey, false);
    playingGenerationRef.current = undefined;
    correctionStartedAtRef.current = undefined;
    preparationStartedAtRef.current = performance.now();
    video.pause();
    try {
      await settlePreparedStartingFrame(video, debug);
      if (stateRef.current.generation !== generation) return;
      update(
        advancePreparedVideoSurface(stateRef.current, generation, "ready"),
      );
      onReadyChange(candidate.mediaKey, true);
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
    }
  }, [
    candidate.mediaKey,
    debug,
    onFirstAdvancingFrameChange,
    onReadyChange,
    publishReady,
    update,
  ]);

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (
      !video ||
      stateRef.current.phase !== "ready" ||
      playingGenerationRef.current === stateRef.current.generation
    ) {
      return;
    }
    const generation = stateRef.current.generation;
    const stateBeforeSend: SurfaceDiagnostic["sendStateBeforeRequest"] =
      stateRef.current.phase === "ready" ? "READY" : "PREPARING";
    const sendRequestedAt = performance.now();
    const sendBufferedRanges: Array<[number, number]> = Array.from(
      { length: video.buffered.length },
      (_, index) => [video.buffered.start(index), video.buffered.end(index)],
    );
    playingGenerationRef.current = generation;
    update(
      advancePreparedVideoSurface(stateRef.current, generation, "playing"),
    );
    onFirstAdvancingFrameChange(candidate.mediaKey, false);
    try {
      publishReady({
        sendRequestTimestamp: sendRequestedAt,
        sendStateBeforeRequest: stateBeforeSend,
        sendCurrentTime: video.currentTime,
        sendReadyState: video.readyState,
        sendPaused: video.paused,
        sendSeeking: video.seeking,
        sendBufferedRanges,
      });
      debug("PLAY_REQUESTED", { mode: "live", sendRequestedAt });
      const playCalledAt = performance.now();
      publishReady({ playCalledTimestamp: playCalledAt });
      await video.play();
      const playResolvedAt = performance.now();
      publishReady({
        playResolvedTimestamp: playResolvedAt,
        sendToPlayRequestMs: playCalledAt - sendRequestedAt,
        sendToPlayResolvedMs: playResolvedAt - sendRequestedAt,
      });
      debug("PLAY_RESOLVED", { mode: "live", playResolvedAt });
      await waitForPresentedFrame(video, debug);
      if (stateRef.current.generation !== generation) return;
      const firstAdvancingFrameAt = performance.now();
      onFirstAdvancingFrameChange(candidate.mediaKey, true);
      publishReady({
        firstAdvancingFrameTimestamp: firstAdvancingFrameAt,
        sendToFirstAdvancingFrameMs: firstAdvancingFrameAt - sendRequestedAt,
      });
      debug("FIRST_ADVANCING_FRAME", { mode: "live", firstAdvancingFrameAt });
      publishReady({
        lastUsedAt: Date.now(),
      });
    } catch (error) {
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
    }
  }, [
    candidate.mediaKey,
    debug,
    onFirstAdvancingFrameChange,
    publishReady,
    update,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    setResolvedSource(undefined);
    void resolveSurfaceSource(candidate.source).then((result) => {
      if (!active) return;
      debug("SOURCE_CHANGE", {
        source: candidate.source,
        resolvedSource: result.source,
        sourceKind: result.sourceKind,
      });
      setSourceKind(result.sourceKind);
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
        onDiagnosticChange?.({
          mediaKey: candidate.mediaKey,
          source: candidate.source,
          phase: failed.phase,
          sourceKind: result.sourceKind,
          error,
        });
      }
    });
    return () => {
      active = false;
    };
  }, [candidate.mediaKey, candidate.source, debug, onDiagnosticChange]);

  useEffect(() => {
    if (!enabled || !resolvedSource) return;
    void prepare();
  }, [enabled, prepare, resolvedSource]);

  const hasView = view !== undefined;

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
    if (stateRef.current.phase === "ready") void play();
  }, [enabled, hasView, play, reset, view?.shouldPlay, state.phase]);

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
      void video.play().catch(() => undefined);
    }
  }, [candidate.mediaKey, view?.playback, view?.shouldPlay]);

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
      onReadyChange(candidate.mediaKey, false);
      onFirstAdvancingFrameChange(candidate.mediaKey, false);
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      stateRef.current = disposePreparedVideoSurface(stateRef.current);
    };
  }, [candidate.mediaKey, debug, onFirstAdvancingFrameChange, onReadyChange]);

  const opacity = view?.opacity;
  const videoBox = view?.videoBox;
  const surfaceRef = useCallback(
    (element: HTMLDivElement | null) =>
      onSurfaceElement(candidate.mediaKey, element),
    [candidate.mediaKey, onSurfaceElement],
  );
  return (
    <div
      ref={surfaceRef}
      className="pointer-events-none absolute inset-0"
      data-testid={`electron-media-surface-${candidate.mediaKey}`}
      data-media-key={candidate.mediaKey}
      data-prepared-state={state.phase}
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
  onReadyChange,
  onFirstAdvancingFrameChange,
  onSurfaceElement,
  onDiagnosticChange,
  transitionStart,
  transitionComplete,
  lastSendPath,
  lastMediaKey,
  posterShown,
  outputId,
  windowRole,
}: ElectronMediaSurfacePoolProps) => {
  const [diagnostics, setDiagnostics] = useState<
    Record<string, SurfaceDiagnostic>
  >({});
  const [rendererMetrics, setRendererMetrics] = useState<
    PreparedVideoMetrics | undefined
  >(undefined);
  const [mountedSurfaceKeys, setMountedSurfaceKeys] = useState<string[]>([]);
  const latestDiagnosticsRef = useRef<
    ReturnType<typeof summarizeElectronMediaSurfaceDiagnostics> | undefined
  >(undefined);
  const previousKeysRef = useRef<string[]>([]);
  const previousCandidatesRef = useRef(
    new Map<string, ElectronMediaSurfaceCandidate>(),
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
  const handleDiagnosticChange = useCallback(
    (diagnostic: SurfaceDiagnostic) => {
      setDiagnostics((current) => ({
        ...current,
        [diagnostic.mediaKey]: {
          ...current[diagnostic.mediaKey],
          ...diagnostic,
        },
      }));
      onDiagnosticChange?.(diagnostic);
    },
    [onDiagnosticChange],
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
      evictionHistoryRef.current = [
        ...evictionHistoryRef.current,
        ...evicted.map((mediaKey) => {
          const detail = detailsByKey.get(mediaKey);
          const previous = previousCandidates.get(mediaKey);
          const reason =
            detail?.status === "eligible"
              ? "budget"
              : previous?.itemId && detail?.itemId && previous.itemId !== detail.itemId
                ? "outline changed"
                : "service removed";
          return `${mediaKey} (${reason})`;
        }),
      ].slice(-64);
    }
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
  }, [candidateDiagnostics, candidateKeySignature]);

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
          candidate.itemId === currentCandidates[0]?.itemId,
      }));
    const surfaceDiagnostics = currentCandidates
      .filter((candidate) => mountedKeySet.has(candidate.mediaKey))
      .map((candidate, index) => {
        const diagnostic = diagnostics[candidate.mediaKey];
        return {
          mediaKey: candidate.mediaKey,
          source: diagnostic?.source || candidate.source,
          phase: diagnostic?.phase ?? ("idle" as const),
          sourceKind: diagnostic?.sourceKind ?? ("remote" as const),
          priority: diagnostic?.priority ?? candidate.priority ?? index,
          protected: diagnostic?.protected ?? candidate.protected,
          prepareToFrameReadyMs: diagnostic?.prepareToFrameReadyMs,
          surfaceState: diagnostic?.surfaceState,
          sendStateBeforeRequest: diagnostic?.sendStateBeforeRequest,
          sendCurrentTime: diagnostic?.sendCurrentTime,
          sendReadyState: diagnostic?.sendReadyState,
          sendPaused: diagnostic?.sendPaused,
          sendSeeking: diagnostic?.sendSeeking,
          sendBufferedRanges: diagnostic?.sendBufferedRanges,
          sendRequestTimestamp: diagnostic?.sendRequestTimestamp,
          playCalledTimestamp: diagnostic?.playCalledTimestamp,
          playResolvedTimestamp: diagnostic?.playResolvedTimestamp,
          transitionStartTimestamp: diagnostic?.transitionStartTimestamp,
          firstAdvancingFrameTimestamp:
            diagnostic?.firstAdvancingFrameTimestamp,
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
      candidateCount: details.filter((detail) => detail.eligible).length,
      discoveredCount: details.length,
      pendingCacheCount: details.filter(
        (detail) =>
          detail.status === "pending-cache" || detail.cacheStatus === "pending",
      ).length,
      candidateDetails: details,
      evictions: evictionHistoryRef.current,
      surfaces: surfaceDiagnostics,
      renderPath: lastSendPath,
      lastSendPath,
      lastMediaKey,
      posterShown,
      rendererMetrics,
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
    posterShown,
    rendererMetrics,
    transitionComplete,
    transitionStart,
    windowRole,
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
    <>
      {candidates.map((candidate) => (
        <PreparedSurface
          key={candidate.mediaKey}
          candidate={candidate}
          view={viewsByKey.get(candidate.mediaKey)}
          enabled={enabled}
          onReadyChange={onReadyChange}
          onFirstAdvancingFrameChange={onFirstAdvancingFrameChange}
          onSurfaceElement={handleSurfaceElement}
          onDiagnosticChange={handleDiagnosticChange}
        />
      ))}
    </>
  );
};

export default ElectronMediaSurfacePool;
