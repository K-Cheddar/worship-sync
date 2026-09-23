import { useEffect, useState } from "react";
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

type LaneFullFrameMediaProps = {
  media: LaneBackgroundMedia;
  /** Outgoing/demoted lane: keep frames, never audible. */
  isPrevious: boolean;
  onPaintReadyChange: (ready: boolean) => void;
  /** Reports when the actual file-video surface can replace its fallback. */
  onLivePaintReadyChange?: (ready: boolean) => void;
  fileVideoAudioEnabled?: boolean;
  volume?: number;
  playbackRole?: "preview" | "output";
  preloadRole?: "preview" | "output";
  suspendPlayback?: boolean;
  /** Cue for the file-video lane; outgoing lanes retain their own cue. */
  playback?: VideoBackgroundPlaybackCue;
  outputId?: string;
  windowRole?: string;
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
  fileVideoAudioEnabled = false,
  volume = 1,
  playbackRole = "output",
  preloadRole,
  suspendPlayback = false,
  playback,
  outputId,
  windowRole,
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

  useEffect(() => {
    setFallbackPaintReady(false);
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
            className={`absolute inset-0 h-full w-full transition-opacity duration-150 ${
              fileVideoBox.shouldKeepAspectRatio ? "object-contain" : "object-cover"
            }`}
            style={{
              opacity: fileVideoPaintReady ? 0 : 1,
              filter: fileVideoBox.brightness
                ? `brightness(${fileVideoBox.brightness}%)`
                : undefined,
            }}
            onLoad={() => setFallbackPaintReady(true)}
            onError={() => setFallbackPaintReady(false)}
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
