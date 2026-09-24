import { useEffect, useRef, useState } from "react";
import type {
  LocalVideoInputPresentation,
  VideoBackgroundPlaybackCue,
} from "../../types";
import { useCachedVideoUrl } from "../../hooks/useCachedMediaUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";
import { logVideoCue } from "../../utils/videoBackgroundPlayback";
import HLSPlayer from "./HLSVideoPlayer";
import LocalVideoInputView from "./LocalVideoInputView";
import type { LaneBackgroundMedia } from "./laneBackgroundMedia";

/** Independent of the configured slide transition: this only reveals a live frame. */
const POSTER_TO_VIDEO_FADE_MS = 200;

type LaneFullFrameMediaProps = {
  media: LaneBackgroundMedia;
  /** Outgoing/demoted lane: keep frames, never audible. */
  isPrevious: boolean;
  onPaintReadyChange: (ready: boolean) => void;
  /** Reports when the actual file-video surface can replace its fallback. */
  onLivePaintReadyChange?: (ready: boolean) => void;
  onPosterPaintReadyChange?: (ready: boolean) => void;
  fileVideoAudioEnabled?: boolean;
  volume?: number;
  playbackRole?: "preview" | "output";
  preloadRole?: "preview" | "output";
  transportRole?: "editor" | "none";
  suspendPlayback?: boolean;
  /** Cue for the file-video lane; outgoing lanes retain their own cue. */
  playback?: VideoBackgroundPlaybackCue;
  outputId?: string;
  windowRole?: string;
  transitionSendTimestamp?: number;
  isEditor?: boolean;
  localVideo?: {
    playAudio: boolean;
    captureEnabled: boolean;
    receiveHighQuality: boolean;
    publishPreview: boolean;
    showErrors: boolean;
    transparentBackground: boolean;
    contentVisible: boolean;
  };
};

const isImmediateVideoProtocol = (url: string) =>
  url.startsWith("worshipsync-media://") ||
  url.startsWith("blob:") ||
  url.startsWith("media-cache://");

/**
 * One lane's full-frame background surface. Reports readiness only; the parent
 * transition stage owns opacity, serialization, and disposal.
 */
const LaneFullFrameMedia = ({
  media,
  isPrevious,
  onPaintReadyChange,
  onLivePaintReadyChange,
  onPosterPaintReadyChange,
  fileVideoAudioEnabled = false,
  volume = 1,
  playbackRole = "output",
  preloadRole,
  transportRole = "none",
  suspendPlayback = false,
  playback,
  outputId,
  windowRole,
  transitionSendTimestamp,
  isEditor = false,
  localVideo,
}: LaneFullFrameMediaProps) => {
  const mediaKind = media.kind;
  const fileOriginalSrc =
    media.kind === "fileVideo" ? media.originalSrc : undefined;
  const fileMediaKey =
    media.kind === "fileVideo" ? media.mediaKey : undefined;
  const fileVideoBox =
    media.kind === "fileVideo" ? media.videoBox : undefined;
  const isLocalProtocol = Boolean(
    fileOriginalSrc && isImmediateVideoProtocol(fileOriginalSrc),
  );
  const cachedRemoteUrl = useCachedVideoUrl(
    mediaKind === "fileVideo" && !isLocalProtocol ? fileOriginalSrc : undefined,
  );
  // Prefer a known local/cache URL on the first commit so the player mounts
  // immediately instead of waiting an effect to fill an empty frozen src.
  const [frozenResolvedSrc, setFrozenResolvedSrc] = useState(() =>
    fileOriginalSrc && isImmediateVideoProtocol(fileOriginalSrc)
      ? fileOriginalSrc
      : "",
  );
  const [frozenForOriginal, setFrozenForOriginal] = useState(
    () => fileOriginalSrc ?? "",
  );
  const [fileVideoPaintReady, setFileVideoPaintReady] = useState(false);
  const localVideoThumbnail = useLocalVideoFileUrl(
    fileVideoBox?.mediaInfo?.localVideoFile,
    "thumbnail",
  );
  const fallbackSrc =
    localVideoThumbnail.url ||
    (media.kind === "fileVideo" ? media.fallbackSrc : undefined);
  const [fallbackPaintReady, setFallbackPaintReady] = useState(false);
  const onPosterPaintReadyChangeRef = useRef(onPosterPaintReadyChange);
  onPosterPaintReadyChangeRef.current = onPosterPaintReadyChange;

  useEffect(() => {
    setFallbackPaintReady(false);
    onPosterPaintReadyChangeRef.current?.(false);
  }, [fallbackSrc]);

  if (
    mediaKind === "fileVideo" &&
    fileOriginalSrc &&
    fileOriginalSrc !== frozenForOriginal
  ) {
    setFrozenForOriginal(fileOriginalSrc);
    setFileVideoPaintReady(false);
    setFrozenResolvedSrc(
      isImmediateVideoProtocol(fileOriginalSrc) ? fileOriginalSrc : "",
    );
  } else if (mediaKind !== "fileVideo" && frozenForOriginal) {
    setFrozenForOriginal("");
    setFrozenResolvedSrc("");
    setFileVideoPaintReady(false);
  }

  useEffect(() => {
    if (
      mediaKind !== "fileVideo" ||
      isLocalProtocol ||
      !cachedRemoteUrl ||
      !fileOriginalSrc
    ) {
      return;
    }
    logVideoCue("lane.cacheResolved", {
      outputId,
      windowRole,
      mediaKey: fileMediaKey,
      originalSrc: fileOriginalSrc,
      resolvedSrc: cachedRemoteUrl,
    });
    setFrozenResolvedSrc((current) => current || cachedRemoteUrl);
  }, [
    cachedRemoteUrl,
    fileOriginalSrc,
    fileMediaKey,
    isLocalProtocol,
    mediaKind,
    outputId,
    windowRole,
  ]);

  useEffect(() => {
    if (mediaKind !== "fileVideo" || !fileOriginalSrc) return;
    logVideoCue("lane.mount", {
      outputId,
      windowRole,
      mediaKey: fileMediaKey,
      originalSrc: fileOriginalSrc,
      resolvedSrc: frozenResolvedSrc || undefined,
    });
  }, [
    fileMediaKey,
    fileOriginalSrc,
    frozenResolvedSrc,
    mediaKind,
    outputId,
    windowRole,
  ]);

  useEffect(() => {
    if (mediaKind === "none") {
      onPaintReadyChange(true);
      return;
    }
    if (mediaKind === "fileVideo") {
      const liveReady = Boolean(frozenResolvedSrc) && fileVideoPaintReady;
      onLivePaintReadyChange?.(liveReady);
      onPaintReadyChange(Boolean(fallbackSrc && fallbackPaintReady) || liveReady);
    }
  }, [
    fallbackPaintReady,
    fallbackSrc,
    fileVideoPaintReady,
    frozenResolvedSrc,
    mediaKind,
    onPaintReadyChange,
    onLivePaintReadyChange,
  ]);

  if (mediaKind === "none") return null;

  if (mediaKind === "fileVideo" && fileOriginalSrc && fileVideoBox) {
    return (
      <div
        className="pointer-events-none absolute inset-0"
        data-testid={
          isPrevious ? "previous-lane-file-video" : "current-lane-file-video"
        }
        data-media-key={fileMediaKey}
        data-paint-ready={fileVideoPaintReady ? "true" : "false"}
        data-fallback-ready={fallbackPaintReady ? "true" : "false"}
      >
        {fallbackSrc && (
          <img
            src={fallbackSrc}
            alt=""
            aria-hidden
            data-testid="file-video-fallback"
            className={`absolute inset-0 h-full w-full transition-opacity ${
              fileVideoBox.shouldKeepAspectRatio ? "object-contain" : "object-cover"
            }`}
            style={{
              opacity: fileVideoPaintReady ? 0 : 1,
              transitionDuration: `${POSTER_TO_VIDEO_FADE_MS}ms`,
              filter: fileVideoBox.brightness
                ? `brightness(${fileVideoBox.brightness}%)`
                : undefined,
            }}
            onLoad={() => {
              setFallbackPaintReady(true);
              onPosterPaintReadyChangeRef.current?.(true);
            }}
            onError={() => {
              setFallbackPaintReady(false);
              onPosterPaintReadyChangeRef.current?.(false);
            }}
            onTransitionEnd={(event) => {
              if (event.propertyName === "opacity" && fileVideoPaintReady) {
                logVideoCue("poster.videoHandoffComplete", {
                  outputId,
                  windowRole,
                  mediaKey: fileMediaKey,
                  fadeDurationMs: POSTER_TO_VIDEO_FADE_MS,
                  sendToPosterVideoCompleteMs:
                    transitionSendTimestamp == null
                      ? undefined
                      : performance.now() - transitionSendTimestamp,
                });
              }
            }}
          />
        )}
        {frozenResolvedSrc && (
          <HLSPlayer
            src={frozenResolvedSrc}
            originalSrc={fileOriginalSrc}
            paintReady={fileVideoPaintReady}
            onLoadedData={() => setFileVideoPaintReady(true)}
            onError={() => setFileVideoPaintReady(false)}
            videoBox={fileVideoBox}
            muted={isPrevious || !fileVideoAudioEnabled}
            volume={volume}
            playbackRole={isEditor ? "preview" : playbackRole}
            preloadRole={preloadRole ?? (isEditor ? "preview" : playbackRole)}
            transportRole={transportRole}
            suspendPlayback={suspendPlayback}
            mediaKey={fileMediaKey}
            playback={playback}
            outputId={outputId}
            windowRole={windowRole}
          />
        )}
      </div>
    );
  }

  if (media.kind !== "localVideo") return null;

  const input: LocalVideoInputPresentation = media.input;
  const local = localVideo ?? {
    playAudio: false,
    captureEnabled: false,
    receiveHighQuality: false,
    publishPreview: false,
    showErrors: false,
    transparentBackground: false,
    contentVisible: true,
  };

  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-testid={
        isPrevious ? "previous-lane-local-video" : "current-lane-local-video"
      }
      data-source-id={input.sourceId}
      style={{ opacity: local.contentVisible ? 1 : 0 }}
    >
      <LocalVideoInputView
        input={input}
        playAudio={local.playAudio && !isPrevious && local.contentVisible}
        volume={volume}
        captureEnabled={local.captureEnabled && !isPrevious}
        receiveHighQuality={local.receiveHighQuality}
        publishPreview={local.publishPreview && !isPrevious}
        showErrors={local.showErrors}
        transparentBackground={local.transparentBackground}
        onPaintReadyChange={onPaintReadyChange}
        outputId={outputId}
        windowRole={windowRole}
        laneRole={isPrevious ? "previous" : "current"}
      />
    </div>
  );
};

export default LaneFullFrameMedia;
