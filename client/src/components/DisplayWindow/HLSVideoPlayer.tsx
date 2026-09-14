import { useRef, useEffect, useCallback } from "react";
import Hls from "hls.js";
import { Box, VideoBackgroundPlaybackCue } from "../../types";
import {
  clearVideoPreviewState,
  logVideoCue,
  reportVideoPreviewState,
  resolveVideoCueCorrection,
  resolveVideoCueDrift,
  resolveVideoPlaybackPosition,
  subscribeVideoPreviewCommands,
  VIDEO_CUE_HARD_SEEK_THRESHOLD_SECONDS,
  VIDEO_CUE_RATE_CORRECTION_MAX_DURATION_MS,
  VIDEO_CUE_DRIFT_TOLERANCE_SECONDS,
  type VideoPreviewCommand,
} from "../../utils/videoBackgroundPlayback";
import {
  getVideoPreload,
  getVideoSourceKind,
  isHLSVideoSource,
} from "../../utils/isInstantVideoSource";

type HLSPlayerProps = {
  src: string;
  /** Original (pre-cache-resolution) URL; used as fallback if a cached file fails to load. */
  originalSrc?: string;
  className?: string;
  onLoadedData?: () => void;
  onError?: () => void;
  videoBox?: Box;
  muted?: boolean;
  volume?: number;
  /** Editor preview reports playhead and follows operator commands. */
  playbackRole?: "preview" | "output";
  /** Buffering policy can differ from playback behavior for controller tiles. */
  preloadRole?: "preview" | "output";
  /** Keep the element mounted but pause it while its containing preview is hidden. */
  suspendPlayback?: boolean;
  mediaKey?: string;
  /** Live/output cue applied when this surface is following a send. */
  playback?: VideoBackgroundPlaybackCue;
};

/** Re-seeking for less than this is invisible and only costs a decode stall. */
const SEEK_EPSILON_SECONDS = 0.05;
/** How often a cue-following surface checks itself against the cue clock. */
const DRIFT_CHECK_INTERVAL_MS = 2000;
/**
 * Resume attempts per cue before giving up. A stalled decode recovers in one;
 * anything more is an autoplay block that only a new operator action clears,
 * and retrying it forever just fills the console.
 */
const MAX_RESUME_RETRIES = 3;

const finiteDuration = (video: HTMLVideoElement): number | undefined =>
  Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : undefined;

const elementState = (video: HTMLVideoElement) => ({
  paused: video.paused,
  readyState: video.readyState,
  networkState: video.networkState,
  currentTime: video.currentTime,
  duration: video.duration,
  buffered: video.buffered.length
    ? `${video.buffered.start(0)}-${video.buffered.end(video.buffered.length - 1)}`
    : "none",
  muted: video.muted,
  seeking: video.seeking,
  errorCode: video.error?.code,
});

const startPlayback = (video: HTMLVideoElement) => {
  logVideoCue("play.before", elementState(video));
  video
    .play()
    .then(() => {
      logVideoCue("play.resolved", elementState(video));
      // If the promise resolved but the playhead never moves, the element is
      // stalled on the source rather than blocked by policy.
      window.setTimeout(
        () => logVideoCue("play.after500ms", elementState(video)),
        500,
      );
    })
    .catch((e) => {
      logVideoCue("play.rejected", {
        name: (e as Error)?.name,
        message: (e as Error)?.message,
        ...elementState(video),
      });
      console.warn("Error playing video", e);
    });
};

const applyCueToVideo = (
  video: HTMLVideoElement,
  cue: VideoBackgroundPlaybackCue,
  options: { seek: boolean },
) => {
  const shouldSeek = options.seek || cue.paused;
  if (shouldSeek) {
    video.playbackRate = 1;
  }
  if (shouldSeek) {
    const target = resolveVideoPlaybackPosition(cue, finiteDuration(video));
    if (Math.abs(video.currentTime - target) > SEEK_EPSILON_SECONDS) {
      video.currentTime = target;
    }
  }
  if (cue.paused) {
    video.pause();
    return;
  }
  startPlayback(video);
};

const HLSPlayer = ({
  src,
  originalSrc,
  className,
  onLoadedData,
  onError,
  videoBox,
  muted = true,
  volume = 1,
  playbackRole,
  preloadRole,
  suspendPlayback = false,
  mediaKey,
  playback,
}: HLSPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const originalSrcRef = useRef(originalSrc);
  originalSrcRef.current = originalSrc;
  const srcRef = useRef(src);
  srcRef.current = src;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const playbackRoleRef = useRef(playbackRole);
  playbackRoleRef.current = playbackRole;
  const suspendPlaybackRef = useRef(suspendPlayback);
  suspendPlaybackRef.current = suspendPlayback;
  const onLoadedDataRef = useRef(onLoadedData);
  onLoadedDataRef.current = onLoadedData;
  /** Src whose metadata (and therefore duration) the element already has. */
  const readySrcRef = useRef<string | null>(null);
  /** Src the current cue was actually applied against. */
  const syncedSrcRef = useRef<string | null>(null);
  /** Src for which DisplayWindow may already hide the poster still. */
  const paintReadySrcRef = useRef<string | null>(null);
  const appliedGenerationRef = useRef<number | null>(null);
  /** Local deadline for a persistent rate correction; never synced. */
  const rateCorrectionStartedAtRef = useRef<number | null>(null);
  /** A seek computed before the duration landed could not wrap a looping cue. */
  const appliedWithoutDurationRef = useRef(false);
  /** Invalidates in-flight seeked/loadeddata waits across rapid source swaps. */
  const paintReadyWaitGenerationRef = useRef(0);
  const paintReadyDisposersRef = useRef<Array<() => void>>([]);

  const clearPaintReadyWaits = useCallback(() => {
    paintReadyDisposersRef.current.forEach((dispose) => dispose());
    paintReadyDisposersRef.current = [];
  }, []);

  /**
   * Tell the display layer it is safe to drop the poster. Wait out an in-flight
   * cue seek and for HAVE_CURRENT_DATA so Electron does not flash black between
   * cached clips.
   */
  const notifyPaintReady = useCallback(
    (videoSrc: string) => {
      const video = videoRef.current;
      if (!video || srcRef.current !== videoSrc) return;
      if (paintReadySrcRef.current === videoSrc) return;

      clearPaintReadyWaits();
      const generation = ++paintReadyWaitGenerationRef.current;

      const isStale = () =>
        generation !== paintReadyWaitGenerationRef.current ||
        srcRef.current !== videoSrc ||
        paintReadySrcRef.current === videoSrc;

      const waitForEvent = (
        eventName: "loadeddata" | "seeked",
        then: () => void,
      ) => {
        let dispose: () => void = () => undefined;
        const handler = () => {
          video.removeEventListener(eventName, handler);
          paintReadyDisposersRef.current =
            paintReadyDisposersRef.current.filter((entry) => entry !== dispose);
          then();
        };
        dispose = () => {
          video.removeEventListener(eventName, handler);
        };
        paintReadyDisposersRef.current.push(dispose);
        video.addEventListener(eventName, handler);
      };

      const finish = () => {
        if (isStale()) return;
        // Cue seeks can start after loadeddata; always recheck before declaring.
        if (video.seeking) {
          waitForEvent("seeked", finish);
          return;
        }
        if (video.readyState < 2 /* HAVE_CURRENT_DATA */) {
          waitForEvent("loadeddata", finish);
          return;
        }
        if (video.seeking) {
          waitForEvent("seeked", finish);
          return;
        }
        paintReadySrcRef.current = videoSrc;
        clearPaintReadyWaits();
        logVideoCue("player.paintReady", {
          role: playbackRoleRef.current,
          ...elementState(video),
        });
        onLoadedDataRef.current?.();
      };

      finish();
    },
    [clearPaintReadyWaits],
  );

  const notifyPaintReadyRef = useRef(notifyPaintReady);
  notifyPaintReadyRef.current = notifyPaintReady;

  /**
   * The one place a cue reaches the element. Every load path (native mp4,
   * hls.js, native HLS, cached-URL fallback) and every cue change funnels
   * here, so the seek/no-seek rule can never drift between them.
   */
  const syncPlayback = useCallback(() => {
    const video = videoRef.current;
    const activeSrc = srcRef.current;
    if (!video || !activeSrc || readySrcRef.current !== activeSrc) {
      logVideoCue("player.notReady", {
        role: playbackRoleRef.current,
        hasVideo: !!video,
        activeSrc,
        readySrc: readySrcRef.current,
        cueGeneration: playbackRef.current?.generation,
      });
      return;
    }

    if (suspendPlaybackRef.current) {
      video.playbackRate = 1;
      rateCorrectionStartedAtRef.current = null;
      video.pause();
      return;
    }

    const cue = playbackRef.current;
    if (!cue) {
      // A rate correction belongs only to the cue that requested it. Do not
      // let it leak into local preview playback after the cue is removed.
      video.playbackRate = 1;
      rateCorrectionStartedAtRef.current = null;
      if (syncedSrcRef.current === activeSrc) return;
      syncedSrcRef.current = activeSrc;
      appliedGenerationRef.current = null;
      // Outputs start on their own; the editor preview waits for the operator.
      if (playbackRoleRef.current !== "preview") startPlayback(video);
      notifyPaintReadyRef.current(activeSrc);
      return;
    }

    const isNewCueGeneration = appliedGenerationRef.current !== cue.generation;
    if (isNewCueGeneration) {
      // Playback-rate correction is render-only state for one cue generation.
      // A new slide must never inherit the prior slide's 1.014x/0.986x rate.
      video.playbackRate = 1;
      rateCorrectionStartedAtRef.current = null;
    } else if (cue.paused) {
      video.playbackRate = 1;
      rateCorrectionStartedAtRef.current = null;
    }
    const hasDuration = finiteDuration(video) !== undefined;
    // A freshly loaded element sits at 0, so it has to seek when the cue is
    // meaningfully away from 0. Cue ~0 on a fresh element is already correct —
    // forcing seek there only adds seeked/decode latency before paint-ready.
    const isFreshSrc = syncedSrcRef.current !== activeSrc;
    const canFixWrap = appliedWithoutDurationRef.current && hasDuration;
    if (
      !isFreshSrc &&
      !canFixWrap &&
      appliedGenerationRef.current === cue.generation
    ) {
      logVideoCue("player.alreadyApplied", {
        role: playbackRoleRef.current,
        generation: cue.generation,
      });
      return;
    }

    const targetPosition = resolveVideoPlaybackPosition(
      cue,
      finiteDuration(video),
    );
    const awayFromCue =
      Math.abs(video.currentTime - targetPosition) > SEEK_EPSILON_SECONDS;
    const seek =
      cue.paused ||
      canFixWrap ||
      ((cue.applySeek || isFreshSrc) && awayFromCue);
    logVideoCue("player.apply", {
      role: playbackRoleRef.current,
      generation: cue.generation,
      paused: cue.paused,
      seek,
      isFreshSrc,
      awayFromCue,
      from: video.currentTime,
      target: targetPosition,
      duration: video.duration,
    });
    applyCueToVideo(video, cue, { seek });
    syncedSrcRef.current = activeSrc;
    appliedGenerationRef.current = cue.generation;
    appliedWithoutDurationRef.current = seek && !hasDuration;
    notifyPaintReadyRef.current(activeSrc);
  }, []);

  const syncPlaybackRef = useRef(syncPlayback);
  syncPlaybackRef.current = syncPlayback;

  /** Metadata is loaded: the element now knows its duration and can be cued. */
  const handleMediaReady = useCallback((videoSrc: string) => {
    readySrcRef.current = videoSrc;
    syncPlaybackRef.current();
  }, []);

  const handleEnded = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = 1;
    rateCorrectionStartedAtRef.current = null;
    const cue = playbackRef.current;
    video.currentTime = cue
      ? resolveVideoPlaybackPosition(cue, finiteDuration(video))
      : 0;
    if (cue?.paused) return;
    startPlayback(video);
  }, []);

  const playNative = useCallback(
    (video: HTMLVideoElement, videoSrc: string) => {
      // Assign the next URL directly. Clearing to "" first blanks the element
      // for a frame before the new source can paint.
      video.src = videoSrc;
      let didFallback = false;

      const handleLoadedMetadata = () => handleMediaReady(videoSrc);

      const handleError = (e: Event) => {
        const el = e.target as HTMLVideoElement;
        const error = el.error;
        console.error(`[HLSPlayer] Error loading video: ${videoSrc}`, {
          error,
          errorCode: error?.code,
          errorMessage: error?.message,
          networkState: el.networkState,
          readyState: el.readyState,
        });

        if (error) {
          switch (error.code) {
            case MediaError.MEDIA_ERR_ABORTED:
              console.error("[HLSPlayer] Video loading aborted");
              break;
            case MediaError.MEDIA_ERR_NETWORK:
              console.error("[HLSPlayer] Network error while loading video");
              break;
            case MediaError.MEDIA_ERR_DECODE:
              console.error("[HLSPlayer] Video decode error");
              break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
              console.error(
                `[HLSPlayer] Video source not supported: ${videoSrc}`,
              );
              break;
          }
        }

        const fallback = originalSrcRef.current;
        if (
          !didFallback &&
          fallback &&
          fallback !== videoSrc &&
          videoSrc.startsWith("media-cache://")
        ) {
          didFallback = true;
          console.log(`[HLSPlayer] Falling back to original URL: ${fallback}`);
          // The element restarts at 0, so the next sync has to re-seek.
          el.playbackRate = 1;
          rateCorrectionStartedAtRef.current = null;
          readySrcRef.current = null;
          syncedSrcRef.current = null;
          video.src = fallback;
          video.load();
        }
      };

      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      video.addEventListener("error", handleError);
      video.addEventListener("ended", handleEnded);

      video.load();

      return () => {
        video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        video.removeEventListener("error", handleError);
        video.removeEventListener("ended", handleEnded);
      };
    },
    [handleEnded, handleMediaReady],
  );

  const playHLS = useCallback(
    (video: HTMLVideoElement, videoSrc: string) => {
      const handleLoadedMetadata = () => handleMediaReady(videoSrc);

      if (Hls.isSupported()) {
        hlsRef.current = null;
        const hls = new Hls();
        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.error(`[HLSPlayer] HLS fatal error: ${data.type}`, data);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              console.error(
                `[HLSPlayer] Unrecoverable HLS error for: ${videoSrc}`,
              );
              hls.destroy();
            }
          }
        });

        hls.loadSource(videoSrc);
        hls.attachMedia(video);

        // MANIFEST_PARSED can land before the element exposes a duration;
        // loadedmetadata then re-syncs so looping cues wrap correctly.
        hls.on(Hls.Events.MANIFEST_PARSED, handleLoadedMetadata);
        video.addEventListener("loadedmetadata", handleLoadedMetadata);

        const handleHlsEnded = () => {
          if (hlsRef.current) hlsRef.current.startLoad(0);
          handleEnded();
        };
        video.addEventListener("ended", handleHlsEnded);

        return () => {
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
          video.removeEventListener("ended", handleHlsEnded);
          hlsRef.current = null;
          hls.destroy();
        };
      }

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = videoSrc;
        video.load();

        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        video.addEventListener("ended", handleEnded);

        return () => {
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
          video.removeEventListener("ended", handleEnded);
        };
      }

      return () => {};
    },
    [handleEnded, handleMediaReady],
  );

  useEffect(() => {
    const video = videoRef.current;
    clearPaintReadyWaits();
    paintReadyWaitGenerationRef.current += 1;
    readySrcRef.current = null;
    syncedSrcRef.current = null;
    paintReadySrcRef.current = null;
    appliedGenerationRef.current = null;
    appliedWithoutDurationRef.current = false;
    rateCorrectionStartedAtRef.current = null;
    if (video) video.playbackRate = 1;
    if (!video || !src) return;

    if (isHLSVideoSource(src)) {
      const stopHls = playHLS(video, src);
      return () => {
        clearPaintReadyWaits();
        paintReadyWaitGenerationRef.current += 1;
        stopHls?.();
        video.playbackRate = 1;
        rateCorrectionStartedAtRef.current = null;
      };
    }
    const stopNative = playNative(video, src);
    return () => {
      clearPaintReadyWaits();
      paintReadyWaitGenerationRef.current += 1;
      stopNative?.();
      video.playbackRate = 1;
      rateCorrectionStartedAtRef.current = null;
    };
  }, [src, playNative, playHLS, clearPaintReadyWaits]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = muted;
    videoRef.current.volume = Math.min(1, Math.max(0, volume));
  }, [muted, volume]);

  // Stall diagnostics. These fire rarely and log nothing unless
  // window.__wsVideoDebug is on, so they cost nothing in a service.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const events = [
      "waiting",
      "stalled",
      "suspend",
      "emptied",
      "abort",
      "playing",
      "pause",
    ] as const;
    const handlers = events.map((name) => {
      const handler = () =>
        logVideoCue(`element.${name}`, {
          role: playbackRoleRef.current,
          ...elementState(video),
        });
      video.addEventListener(name, handler);
      return [name, handler] as const;
    });
    return () => {
      handlers.forEach(([name, handler]) =>
        video.removeEventListener(name, handler),
      );
    };
  }, []);

  // Cue changes (and the load paths above) both route through syncPlayback,
  // which no-ops until the element has metadata for the current src.
  useEffect(() => {
    syncPlayback();
  }, [playback, src, syncPlayback]);

  // Hidden controller tabs keep the video element and decoded position alive,
  // but must not continue decoding or advancing a tile that is not visible.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (suspendPlayback) {
      video.playbackRate = 1;
      rateCorrectionStartedAtRef.current = null;
      video.pause();
      return;
    }

    syncPlayback();
    const cue = playbackRef.current;
    if (video.paused && cue && !cue.paused) {
      startPlayback(video);
    } else if (
      video.paused &&
      !cue &&
      playbackRoleRef.current !== "preview" &&
      readySrcRef.current === srcRef.current
    ) {
      startPlayback(video);
    }
  }, [suspendPlayback, syncPlayback]);

  /**
   * Holds every cue-following surface on the cue clock. Decode start latency,
   * buffering stalls and background-tab throttling all push a surface off the
   * shared timeline; without this the operator's scrubber and the screen
   * disagree, and two outputs disagree with each other.
   */
  useEffect(() => {
    if (!playback || playback.paused || suspendPlayback) return;
    const video = videoRef.current;
    if (!video) return;

    let resumeRetries = 0;
    const id = window.setInterval(() => {
      const cue = playbackRef.current;
      if (!cue || cue.paused || suspendPlaybackRef.current) {
        video.playbackRate = 1;
        rateCorrectionStartedAtRef.current = null;
        return;
      }
      if (syncedSrcRef.current !== srcRef.current) return;
      if (video.paused) {
        video.playbackRate = 1;
        rateCorrectionStartedAtRef.current = null;
        // Recovers a resume whose play() was rejected or stalled.
        if (resumeRetries < MAX_RESUME_RETRIES) {
          resumeRetries += 1;
          startPlayback(video);
        }
        return;
      }
      resumeRetries = 0;
      if (video.seeking) return;

      const duration = finiteDuration(video);
      const drift = resolveVideoCueDrift(cue, video.currentTime, duration);
      let correction = resolveVideoCueCorrection(drift, video.playbackRate);
      const expectedPosition = resolveVideoPlaybackPosition(cue, duration);
      const isRateCorrection =
        correction.correction === "speed up" ||
        correction.correction === "slow down";
      let correctionElapsedMs = 0;
      if (isRateCorrection) {
        const nowMs = Date.now();
        const startedAtMs = rateCorrectionStartedAtRef.current ?? nowMs;
        rateCorrectionStartedAtRef.current = startedAtMs;
        correctionElapsedMs = nowMs - startedAtMs;
        if (correctionElapsedMs >= VIDEO_CUE_RATE_CORRECTION_MAX_DURATION_MS) {
          correction = {
            correction: "hard seek",
            playbackRate: 1,
            shouldSeek: true,
          };
        }
      } else {
        rateCorrectionStartedAtRef.current = null;
      }
      if (correction.shouldSeek) {
        rateCorrectionStartedAtRef.current = null;
      }
      logVideoCue("player.drift", {
        role: playbackRoleRef.current,
        sourceKind: getVideoSourceKind(srcRef.current),
        expectedPosition,
        actualPosition: video.currentTime,
        signedDrift: drift,
        currentPlaybackRate: video.playbackRate,
        correction: correction.correction,
        targetPlaybackRate: correction.playbackRate,
        correctionElapsedMs,
        rateCorrectionDeadlineMs: VIDEO_CUE_RATE_CORRECTION_MAX_DURATION_MS,
        toleranceSeconds: VIDEO_CUE_DRIFT_TOLERANCE_SECONDS,
        hardSeekThresholdSeconds: VIDEO_CUE_HARD_SEEK_THRESHOLD_SECONDS,
      });

      if (video.playbackRate !== correction.playbackRate) {
        video.playbackRate = correction.playbackRate;
      }
      if (!correction.shouldSeek) return;
      if (
        !Number.isFinite(video.currentTime) ||
        Math.abs(video.currentTime - expectedPosition) > SEEK_EPSILON_SECONDS
      ) {
        video.currentTime = expectedPosition;
      }
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [playback, suspendPlayback]);

  // The preview element is the single source of measured playhead/duration,
  // including while a cue drives it — the transport scrubber needs a duration
  // whether or not the slide is live.
  useEffect(() => {
    if (playbackRole !== "preview") return;
    const video = videoRef.current;
    if (!video || !mediaKey) return;

    const report = () => {
      reportVideoPreviewState({
        mediaKey,
        currentTime: video.currentTime || 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        paused: video.paused,
      });
    };

    video.addEventListener("timeupdate", report);
    video.addEventListener("play", report);
    video.addEventListener("pause", report);
    video.addEventListener("seeked", report);
    video.addEventListener("loadedmetadata", report);
    video.addEventListener("durationchange", report);
    report();

    return () => {
      video.removeEventListener("timeupdate", report);
      video.removeEventListener("play", report);
      video.removeEventListener("pause", report);
      video.removeEventListener("seeked", report);
      video.removeEventListener("loadedmetadata", report);
      video.removeEventListener("durationchange", report);
      clearVideoPreviewState(mediaKey);
    };
  }, [playbackRole, mediaKey]);

  // Local transport commands only apply when no cue is driving this surface;
  // once the slide is live the cue is the single authority.
  useEffect(() => {
    if (playbackRole !== "preview" || playback) return;
    const applyCommand = (command: VideoPreviewCommand) => {
      const video = videoRef.current;
      if (!video) return;
      if (command.type === "play") {
        video.playbackRate = 1;
        rateCorrectionStartedAtRef.current = null;
        startPlayback(video);
        return;
      }
      if (command.type === "pause") {
        video.playbackRate = 1;
        rateCorrectionStartedAtRef.current = null;
        video.pause();
        return;
      }
      if (command.type === "seek") {
        video.playbackRate = 1;
        rateCorrectionStartedAtRef.current = null;
        video.currentTime = command.positionSeconds;
        return;
      }
      video.playbackRate = 1;
      rateCorrectionStartedAtRef.current = null;
      video.currentTime = 0;
      startPlayback(video);
    };

    return subscribeVideoPreviewCommands(applyCommand);
  }, [playback, playbackRole]);

  const preloadValue = getVideoPreload(src, preloadRole ?? playbackRole);

  return (
    <video
      ref={videoRef}
      data-testid="hls-video-player"
      preload={preloadValue}
      className={
        className ||
        `absolute inset-0 h-full w-full z-0 ${
          videoBox?.shouldKeepAspectRatio ? "object-contain" : "object-cover"
        }`
      }
      style={{
        filter: videoBox?.brightness
          ? `brightness(${videoBox.brightness}%)`
          : "",
      }}
      autoPlay={false}
      muted={muted}
      loop
      onError={onError}
    />
  );
};

export default HLSPlayer;
