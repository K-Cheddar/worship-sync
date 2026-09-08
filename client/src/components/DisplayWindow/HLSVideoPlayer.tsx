import { useRef, useEffect, useCallback } from "react";
import Hls from "hls.js";
import { Box, VideoBackgroundPlaybackCue } from "../../types";
import {
  clearVideoPreviewState,
  logVideoCue,
  reportVideoPreviewState,
  resolveVideoCueDrift,
  resolveVideoPlaybackPosition,
  subscribeVideoPreviewCommands,
  VIDEO_CUE_DRIFT_TOLERANCE_SECONDS,
  type VideoPreviewCommand,
} from "../../utils/videoBackgroundPlayback";

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
  if (options.seek) {
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
  /** Src whose metadata (and therefore duration) the element already has. */
  const readySrcRef = useRef<string | null>(null);
  /** Src the current cue was actually applied against. */
  const syncedSrcRef = useRef<string | null>(null);
  const appliedGenerationRef = useRef<number | null>(null);
  /** A seek computed before the duration landed could not wrap a looping cue. */
  const appliedWithoutDurationRef = useRef(false);

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

    const cue = playbackRef.current;
    if (!cue) {
      if (syncedSrcRef.current === activeSrc) return;
      syncedSrcRef.current = activeSrc;
      appliedGenerationRef.current = null;
      // Outputs start on their own; the editor preview waits for the operator.
      if (playbackRoleRef.current !== "preview") startPlayback(video);
      return;
    }

    const hasDuration = finiteDuration(video) !== undefined;
    // A freshly loaded element sits at 0, so it has to seek even for a cue
    // that tells live surfaces to keep their playhead — that is the case when
    // the cached URL resolves (or falls back) underneath a running video.
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

    const seek = cue.applySeek || isFreshSrc || canFixWrap;
    logVideoCue("player.apply", {
      role: playbackRoleRef.current,
      generation: cue.generation,
      paused: cue.paused,
      seek,
      isFreshSrc,
      from: video.currentTime,
      duration: video.duration,
    });
    applyCueToVideo(video, cue, { seek });
    syncedSrcRef.current = activeSrc;
    appliedGenerationRef.current = cue.generation;
    appliedWithoutDurationRef.current = seek && !hasDuration;
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
    const cue = playbackRef.current;
    video.currentTime = cue
      ? resolveVideoPlaybackPosition(cue, finiteDuration(video))
      : 0;
    if (cue?.paused) return;
    startPlayback(video);
  }, []);

  const playNative = useCallback(
    (video: HTMLVideoElement, videoSrc: string) => {
      if (video.src && video.src !== videoSrc) {
        video.src = "";
      }

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

      return () => { };
    },
    [handleEnded, handleMediaReady],
  );

  useEffect(() => {
    readySrcRef.current = null;
    syncedSrcRef.current = null;
    appliedGenerationRef.current = null;
    appliedWithoutDurationRef.current = false;
    if (!videoRef.current || !src) return;

    if (src.endsWith(".m3u8")) {
      return playHLS(videoRef.current, src);
    }
    return playNative(videoRef.current, src);
  }, [src, playNative, playHLS]);

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

  /**
   * Holds every cue-following surface on the cue clock. Decode start latency,
   * buffering stalls and background-tab throttling all push a surface off the
   * shared timeline; without this the operator's scrubber and the screen
   * disagree, and two outputs disagree with each other.
   */
  useEffect(() => {
    if (!playback || playback.paused) return;
    const video = videoRef.current;
    if (!video) return;

    let resumeRetries = 0;
    const id = window.setInterval(() => {
      const cue = playbackRef.current;
      if (!cue || cue.paused) return;
      if (syncedSrcRef.current !== srcRef.current) return;
      if (video.paused) {
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
      if (Math.abs(drift) <= VIDEO_CUE_DRIFT_TOLERANCE_SECONDS) return;
      video.currentTime = resolveVideoPlaybackPosition(cue, duration);
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [playback]);

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
        startPlayback(video);
        return;
      }
      if (command.type === "pause") {
        video.pause();
        return;
      }
      if (command.type === "seek") {
        video.currentTime = command.positionSeconds;
        return;
      }
      video.currentTime = 0;
      startPlayback(video);
    };

    return subscribeVideoPreviewCommands(applyCommand);
  }, [playback, playbackRole]);

  const preloadValue =
    src.startsWith("media-cache://") ||
      src.startsWith("worshipsync-media://") ||
      src.startsWith("blob:")
      ? "auto"
      : "metadata";

  return (
    <video
      ref={videoRef}
      data-testid="hls-video-player"
      preload={preloadValue}
      className={
        className ||
        `absolute inset-0 h-full w-full z-0 ${videoBox?.shouldKeepAspectRatio ? "object-contain" : "object-cover"
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
      onLoadedData={onLoadedData}
      onError={onError}
    />
  );
};

export default HLSPlayer;
