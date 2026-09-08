import { useEffect, useRef, useState } from "react";
import { VideoOff, VolumeX } from "lucide-react";
import type { LocalVideoInputPresentation } from "../../types";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import {
  getAudioInputErrorMessage,
  getLocalVideoSourceErrorMessage,
  isDesktopCaptureKind,
  resolveLocalVideoInputBinding,
} from "../../utils/localVideoInput";
import {
  acquireWarmLocalVideoCapture,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
} from "../../utils/localVideoCapturePool";
import { subscribeLocalVideoMedia } from "../../utils/localVideoMediaRelay";
import { subscribeLocalVideoPreview } from "../../utils/localVideoPreviewRelay";
import {
  type LocalVideoRealtimeSubscription,
  subscribeLocalVideoRealtime,
  supportsLocalVideoRealtimeRelay,
} from "../../utils/localVideoRealtimeRelay";
import { subscribeLocalVideoCaptureQuality } from "../../utils/localVideoCaptureQualityRelay";
import { subscribeBrowserDesktopShares } from "../../utils/desktopCapture";

type LocalVideoInputViewProps = {
  input: LocalVideoInputPresentation;
  playAudio?: boolean;
  /** Normalized playback level for this physical screen. */
  volume?: number;
  captureEnabled?: boolean;
  receiveHighQuality?: boolean;
  publishPreview?: boolean;
  showErrors?: boolean;
  transparentBackground?: boolean;
};

const getRenderedPixelSize = (element: HTMLElement) => {
  const bounds = element.getBoundingClientRect();
  const scale = Math.max(1, window.devicePixelRatio || 1);
  const cssWidth = bounds.width || window.innerWidth;
  const cssHeight = bounds.height || window.innerHeight;
  return {
    width: Math.max(1, Math.round(cssWidth * scale)),
    height: Math.max(1, Math.round(cssHeight * scale)),
  };
};

const LocalVideoInputStatus = ({
  compact = false,
  detail,
  heading = "Video input unavailable",
  transparentBackground = false,
}: {
  compact?: boolean;
  detail: string;
  heading?: string;
  transparentBackground?: boolean;
}) => (
  <div
    className={
      compact
        ? `absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center text-white ${transparentBackground ? "bg-transparent" : "bg-black"}`
        : `absolute inset-0 flex flex-col items-center justify-center gap-4 px-12 text-center text-white ${transparentBackground ? "bg-transparent" : "bg-black"}`
    }
    role="status"
  >
    <VideoOff
      className={
        compact ? "size-6 text-neutral-400" : "size-16 text-neutral-400"
      }
      aria-hidden
    />
    <div>
      <p
        className={compact ? "text-sm font-semibold" : "text-4xl font-semibold"}
      >
        {heading}
      </p>
      <p
        className={
          compact
            ? "mt-0.5 text-[11px] leading-tight text-neutral-300"
            : "mt-3 text-2xl text-neutral-300"
        }
      >
        {detail}
      </p>
    </div>
  </div>
);

/** Renders a warm local capture or a local-only fallback for another window. */
const LocalVideoInputView = ({
  input,
  playAudio = false,
  volume = 1,
  captureEnabled = true,
  receiveHighQuality = false,
  publishPreview = false,
  showErrors = true,
  transparentBackground = false,
}: LocalVideoInputViewProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const realtimeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const realtimeSubscriptionRef = useRef<
    LocalVideoRealtimeSubscription | undefined
  >(undefined);
  const captureConsumerIdRef = useRef(
    globalThis.crypto?.randomUUID?.() ??
      `local-video-view-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const previewFrameUrlRef = useRef<string | undefined>(undefined);
  const retiredPreviewFrameUrlsRef = useRef(new Set<string>());
  const previewFramePendingRef = useRef(false);
  const [previewFrameUrl, setPreviewFrameUrl] = useState<string>();
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  /**
   * A browser share only restarts from a click on its own workstation. Another
   * app window may still be relaying it, so this is shown only while nothing
   * is on screen.
   */
  const [restartDetail, setRestartDetail] = useState<string | null>(null);
  const [audioWarning, setAudioWarning] = useState<string | null>(null);
  const [isDirectReady, setIsDirectReady] = useState(false);
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const [captureOwnedElsewhere, setCaptureOwnedElsewhere] = useState(false);
  const [captureAttempt, setCaptureAttempt] = useState(0);
  const isDesktopShare = isDesktopCaptureKind(input.captureKind);
  const unavailableHeading = isDesktopShare
    ? `${input.captureKind === "window" ? "Window" : "Screen"} share unavailable`
    : "Video input unavailable";
  const isLocal = input.ownerDeviceId === getOrCreateDeviceId();
  const binding = isLocal
    ? resolveLocalVideoInputBinding(input.sourceId)
    : undefined;
  const deviceId = binding?.deviceId;
  const audioDeviceId = binding?.audioDeviceId;
  const normalizedVolume = Math.min(1, Math.max(0, volume));
  const normalizedVolumeRef = useRef(normalizedVolume);
  const playAudioRef = useRef(playAudio);
  normalizedVolumeRef.current = normalizedVolume;
  playAudioRef.current = playAudio;
  const canUseRealtimeRelay =
    isLocal && receiveHighQuality && supportsLocalVideoRealtimeRelay();

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = normalizedVolume;
    realtimeSubscriptionRef.current?.setVolume(normalizedVolume);
  }, [normalizedVolume]);

  useEffect(() => {
    realtimeSubscriptionRef.current?.setAudioEnabled(playAudio);
  }, [playAudio]);

  useEffect(() => {
    if (!isLocal || (!receiveHighQuality && !captureOwnedElsewhere)) return;
    const video = videoRef.current;
    if (!video) return;
    setErrorDetail(null);
    setIsDirectReady(false);
    let active = true;
    let stopBufferedRelay: (() => void) | undefined;
    let qualitySubscription:
      | ReturnType<typeof subscribeLocalVideoCaptureQuality>
      | undefined;
    let targetSizeObserver: ResizeObserver | undefined;
    let observedOutputElement: HTMLElement | undefined;
    const syncOutputTargetSize = () => {
      if (!observedOutputElement) return;
      const target = getRenderedPixelSize(observedOutputElement);
      qualitySubscription?.updateTargetSize(target.width, target.height);
    };
    const subscribeBufferedRelay = () => {
      if (!active || stopBufferedRelay) return;
      setIsRealtimeActive(false);
      stopBufferedRelay = subscribeLocalVideoMedia(input.sourceId, video, {
        includeAudio: playAudioRef.current,
        onStarted: () => setErrorDetail(null),
        onError: setErrorDetail,
        onStopped: () => setIsDirectReady(false),
      });
    };

    if (canUseRealtimeRelay && realtimeCanvasRef.current) {
      setIsRealtimeActive(true);
      const realtimeSubscription = subscribeLocalVideoRealtime(
        input.sourceId,
        realtimeCanvasRef.current,
        {
          includeAudio: playAudioRef.current,
          volume: normalizedVolumeRef.current,
          onStarted: () => {
            setErrorDetail(null);
            setIsDirectReady(true);
          },
          onStopped: () => setIsDirectReady(false),
          onError: setErrorDetail,
          onFallback: () => {
            if (!active) return;
            realtimeSubscriptionRef.current?.stop();
            realtimeSubscriptionRef.current = undefined;
            setIsDirectReady(false);
            subscribeBufferedRelay();
          },
        },
      );
      realtimeSubscriptionRef.current = realtimeSubscription;
    } else {
      subscribeBufferedRelay();
    }

    if (receiveHighQuality) {
      observedOutputElement = canUseRealtimeRelay
        ? (realtimeCanvasRef.current ?? undefined)
        : (videoRef.current ?? undefined);
    }
    if (observedOutputElement) {
      const initialTarget = getRenderedPixelSize(observedOutputElement);
      qualitySubscription = subscribeLocalVideoCaptureQuality(
        input.sourceId,
        initialTarget.width,
        initialTarget.height,
      );
      if (typeof ResizeObserver !== "undefined") {
        targetSizeObserver = new ResizeObserver(syncOutputTargetSize);
        targetSizeObserver.observe(observedOutputElement);
      }
      window.addEventListener("resize", syncOutputTargetSize);
    }

    return () => {
      active = false;
      targetSizeObserver?.disconnect();
      window.removeEventListener("resize", syncOutputTargetSize);
      qualitySubscription?.stop();
      realtimeSubscriptionRef.current?.stop();
      realtimeSubscriptionRef.current = undefined;
      stopBufferedRelay?.();
    };
  }, [
    canUseRealtimeRelay,
    captureOwnedElsewhere,
    input.sourceId,
    isLocal,
    receiveHighQuality,
  ]);

  useEffect(() => {
    if (
      !isLocal ||
      (publishPreview && !captureOwnedElsewhere) ||
      isDirectReady
    ) {
      return;
    }
    setErrorDetail(null);
    const clearPreviewFrames = () => {
      if (previewFrameUrlRef.current) {
        URL.revokeObjectURL(previewFrameUrlRef.current);
        previewFrameUrlRef.current = undefined;
      }
      retiredPreviewFrameUrlsRef.current.forEach((url) =>
        URL.revokeObjectURL(url),
      );
      retiredPreviewFrameUrlsRef.current.clear();
      previewFramePendingRef.current = false;
    };
    const unsubscribe = subscribeLocalVideoPreview(input.sourceId, (frame) => {
      if (!frame) {
        clearPreviewFrames();
        setPreviewFrameUrl(undefined);
        return;
      }
      if (previewFramePendingRef.current) return;
      const nextUrl = URL.createObjectURL(frame);
      const previousUrl = previewFrameUrlRef.current;
      if (previousUrl) retiredPreviewFrameUrlsRef.current.add(previousUrl);
      previewFrameUrlRef.current = nextUrl;
      previewFramePendingRef.current = true;
      setPreviewFrameUrl(nextUrl);
    });
    return () => {
      unsubscribe();
      clearPreviewFrames();
    };
  }, [
    captureOwnedElsewhere,
    input.sourceId,
    isDirectReady,
    isLocal,
    publishPreview,
  ]);

  useEffect(() => {
    if (!isLocal || !captureEnabled) return;
    if (!deviceId) {
      setErrorDetail(
        isDesktopCaptureKind(input.captureKind)
          ? "Choose this share again on the source device, then try again."
          : "Choose this input again on the source device, then try again.",
      );
      return;
    }
    let active = true;
    let retryTimer: number | undefined;
    let playbackRecoveryTimer: number | undefined;
    let directPlaybackReady = false;
    const video = videoRef.current;
    const captureConsumerId = captureConsumerIdRef.current;
    const retryCapture = (delayMs = 0) => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        if (active) setCaptureAttempt((attempt) => attempt + 1);
      }, delayMs);
    };
    const handleVideoTrackEnded = () => {
      if (!active) return;
      setIsDirectReady(false);
      setErrorDetail(null);
      retryCapture();
    };
    const handleAudioTrackEnded = () => {
      if (!active) return;
      setAudioWarning(
        "Sound disconnected. Reconnect the audio input; video will continue.",
      );
    };
    setErrorDetail(null);
    setAudioWarning(null);
    setIsDirectReady(false);

    const startCapture = async () => {
      try {
        const captureBinding = resolveLocalVideoInputBinding(input.sourceId);
        if (!captureBinding) return;
        const { stream, audioError } = await acquireWarmLocalVideoCapture(
          input.sourceId,
          captureBinding,
          publishPreview,
          captureConsumerId,
        );
        if (!active) return;
        setCaptureOwnedElsewhere(false);
        setRestartDetail(null);
        stream
          .getVideoTracks()
          .forEach((track) =>
            track.addEventListener?.("ended", handleVideoTrackEnded),
          );
        stream
          .getAudioTracks()
          .forEach((track) =>
            track.addEventListener?.("ended", handleAudioTrackEnded),
          );
        if (video) {
          video.srcObject = stream;
          const resumeDirectPlayback = () => {
            if (!active || video.srcObject !== stream) return;
            if (
              video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
              video.videoWidth > 0
            ) {
              directPlaybackReady = true;
              video.volume = normalizedVolumeRef.current;
              setIsDirectReady(true);
              if (playbackRecoveryTimer !== undefined) {
                window.clearInterval(playbackRecoveryTimer);
                playbackRecoveryTimer = undefined;
              }
              return;
            }
            // A detached Electron capture element can occasionally miss its
            // initial autoplay attempt. Retry playback without reopening or
            // renegotiating the USB device.
            const playPromise = video.play();
            void playPromise?.catch(() => undefined);
          };
          resumeDirectPlayback();
          if (!directPlaybackReady) {
            playbackRecoveryTimer = window.setInterval(
              resumeDirectPlayback,
              500,
            );
          }
        }
        if (audioError && playAudio) {
          setAudioWarning(
            `${getAudioInputErrorMessage(audioError)} Video will continue without sound.`,
          );
        }
      } catch (error) {
        await releaseWarmLocalVideoCapture(input.sourceId, captureConsumerId);
        if (!active) return;
        if (error instanceof LocalVideoCaptureOwnedError) {
          setCaptureOwnedElsewhere(true);
          return;
        }
        // A stopped browser share cannot be reopened without an operator click.
        // Fall back to whichever window still relays it instead of retrying.
        if (
          error instanceof Error &&
          error.name === "DesktopCaptureShareEndedError"
        ) {
          setRestartDetail(
            getLocalVideoSourceErrorMessage(error, input.captureKind),
          );
          setCaptureOwnedElsewhere(true);
          return;
        }
        setErrorDetail(
          getLocalVideoSourceErrorMessage(error, input.captureKind),
        );
        retryCapture(Math.min(1_000 * 2 ** Math.min(captureAttempt, 3), 8_000));
      }
    };
    void startCapture();

    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (playbackRecoveryTimer !== undefined) {
        window.clearInterval(playbackRecoveryTimer);
      }
      void releaseWarmLocalVideoCapture(input.sourceId, captureConsumerId);
      const stream = video?.srcObject as MediaStream | null | undefined;
      stream?.getTracks?.().forEach((track) => {
        track.removeEventListener?.("ended", handleVideoTrackEnded);
        track.removeEventListener?.("ended", handleAudioTrackEnded);
      });
      if (video) video.srcObject = null;
    };
  }, [
    audioDeviceId,
    captureAttempt,
    captureEnabled,
    deviceId,
    input.captureKind,
    input.sourceId,
    isLocal,
    playAudio,
    publishPreview,
  ]);

  // Re-sharing in this window does not change any saved binding, so watch for
  // the replacement stream directly instead of waiting for a capture retry.
  useEffect(() => {
    if (!restartDetail) return;
    const unsubscribe = subscribeBrowserDesktopShares((sourceId) => {
      if (sourceId === input.sourceId) {
        setCaptureAttempt((attempt) => attempt + 1);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [input.sourceId, restartDetail]);

  if (!isLocal) {
    if (!showErrors) {
      return (
        <div
          className={`absolute inset-0 ${transparentBackground ? "bg-transparent" : "bg-black"}`}
          data-testid="local-video-input"
        />
      );
    }
    return (
      <LocalVideoInputStatus
        heading={unavailableHeading}
        detail={`This ${isDesktopShare ? "share" : "input"} is available only on ${input.ownerLabel}. Open a selected display on that device.`}
        transparentBackground={transparentBackground}
      />
    );
  }

  // A relayed picture from another app window outranks a local restart notice.
  const isShowingPicture = isDirectReady || Boolean(previewFrameUrl);
  const statusDetail = errorDetail ?? (isShowingPicture ? null : restartDetail);

  return (
    <div
      className={`absolute inset-0 ${transparentBackground ? "bg-transparent" : "bg-black"}`}
      data-testid="local-video-input"
    >
      {previewFrameUrl && !errorDetail ? (
        <img
          src={previewFrameUrl}
          className={`absolute inset-0 h-full w-full ${input.fit === "cover" ? "object-cover" : "object-contain"}`}
          alt={`${input.deviceLabel} local preview`}
          onLoad={() => {
            previewFramePendingRef.current = false;
            retiredPreviewFrameUrlsRef.current.forEach((url) =>
              URL.revokeObjectURL(url),
            );
            retiredPreviewFrameUrlsRef.current.clear();
          }}
          onError={(event) => {
            previewFramePendingRef.current = false;
            const failedUrl = previewFrameUrl;
            if (failedUrl) {
              URL.revokeObjectURL(failedUrl);
              retiredPreviewFrameUrlsRef.current.delete(failedUrl);
            }
            retiredPreviewFrameUrlsRef.current.forEach((url) =>
              URL.revokeObjectURL(url),
            );
            retiredPreviewFrameUrlsRef.current.clear();
            if (previewFrameUrlRef.current === failedUrl) {
              previewFrameUrlRef.current = undefined;
              setPreviewFrameUrl(undefined);
            }
            event.currentTarget.removeAttribute("src");
          }}
        />
      ) : null}
      {captureEnabled || receiveHighQuality || captureOwnedElsewhere ? (
        <>
          {canUseRealtimeRelay ? (
            <canvas
              ref={realtimeCanvasRef}
              className={`absolute inset-0 h-full w-full transition-none ${isRealtimeActive && isDirectReady && !errorDetail ? "opacity-100" : "opacity-0"} ${input.fit === "cover" ? "object-cover" : "object-contain"}`}
              aria-label={`${input.deviceLabel} realtime video`}
            />
          ) : null}
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full transition-none ${!isRealtimeActive && isDirectReady && !errorDetail ? "opacity-100" : "opacity-0"} ${input.fit === "cover" ? "object-cover" : "object-contain"}`}
            autoPlay
            muted={!playAudio}
            playsInline
            aria-label={input.deviceLabel}
            onLoadedData={() => {
              if (videoRef.current) videoRef.current.volume = normalizedVolume;
              setIsDirectReady(true);
            }}
            onError={() =>
              setErrorDetail(
                isDesktopShare
                  ? `Choose the ${input.captureKind === "window" ? "window" : "screen"} again on this computer, then try again.`
                  : "Check the input connection and camera permission, then try again.",
              )
            }
          />
        </>
      ) : null}
      {showErrors && statusDetail ? (
        <LocalVideoInputStatus
          heading={unavailableHeading}
          detail={statusDetail}
          transparentBackground={transparentBackground}
        />
      ) : null}
      {showErrors && audioWarning && !statusDetail ? (
        <div
          className="absolute inset-x-6 bottom-6 flex items-center justify-center gap-3 rounded bg-black/80 px-5 py-3 text-center text-xl text-white"
          role="status"
        >
          <VolumeX className="size-6 shrink-0" aria-hidden />
          <span>{audioWarning}</span>
        </div>
      ) : null}
    </div>
  );
};

export default LocalVideoInputView;
