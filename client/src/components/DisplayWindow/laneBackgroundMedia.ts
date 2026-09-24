import type { Box, LocalVideoInputPresentation } from "../../types";
import { getImageFromVideoUrl } from "../../utils/generalUtils";
import { getVideoBackgroundMediaKey } from "../../utils/videoBackgroundPlayback";

export type LaneBackgroundMedia =
  | { kind: "none" }
  | {
      kind: "fileVideo";
      mediaKey: string;
      originalSrc: string;
      videoBox: Box;
      fallbackSrc?: string;
    }
  | {
      kind: "localVideo";
      input: LocalVideoInputPresentation;
    };

export const NONE_LANE_BACKGROUND_MEDIA: LaneBackgroundMedia = { kind: "none" };

export const getLaneBackgroundMediaKey = (
  media: LaneBackgroundMedia | undefined,
): string => {
  if (!media || media.kind === "none") return "none";
  if (media.kind === "fileVideo") return `file:${media.mediaKey}`;
  return `local:${media.input.sourceId}`;
};

/** Stable identity for one box's background image / local still. */
export const getBoxBackgroundIdentity = (box: Box | undefined): string => {
  if (!box) return "";
  const localImage = box.mediaInfo?.localImage;
  if (localImage) {
    return `local-image:${localImage.id}:${localImage.contentRevision ?? "legacy"}`;
  }
  const localVideoFile = box.mediaInfo?.localVideoFile;
  if (localVideoFile) {
    return `local-video:${localVideoFile.id}:${localVideoFile.contentRevision ?? "legacy"}`;
  }
  if (box.mediaInfo?.type === "video") {
    return `video-still:${box.mediaInfo.placeholderImage ?? box.mediaInfo.background ?? ""}`;
  }
  return `remote:${box.background ?? ""}`;
};

/**
 * Background surface identity for reuse decisions. Distinct from the full slide
 * snapshot key so lyric-only changes can keep the same live media mounted.
 * Text-only slides (no real background) stay distinct so they still crossfade.
 */
export const getSnapshotBackgroundIdentity = (
  media: LaneBackgroundMedia | undefined,
  boxes: Box[] = [],
): string => {
  const fullFrameKey = getLaneBackgroundMediaKey(media);
  if (fullFrameKey !== "none") return fullFrameKey;
  const boxIdentities = boxes
    .map((box) => getBoxBackgroundIdentity(box))
    .filter(
      (identity) =>
        identity && identity !== "remote:" && identity !== "video-still:",
    );
  if (boxIdentities.length === 0) {
    return `text:${boxes.map((box) => `${box.id}:${box.words ?? ""}`).join("|")}`;
  }
  return `boxes:${boxIdentities.join("|")}`;
};

/**
 * Foreground/content identity for transition decisions. Excludes background
 * media fields so lyric and layout changes can crossfade while media persists.
 * Time/timer values are omitted — they update in place and must not start a fade.
 */
export const getSnapshotForegroundIdentity = (boxes: Box[] = []): string =>
  JSON.stringify(
    boxes.map((box) => ({
      id: box.id,
      words: box.words,
      width: box.width,
      height: box.height,
      x: box.x,
      y: box.y,
      fontSize: box.fontSize,
      align: box.align,
      isBold: box.isBold,
      isItalic: box.isItalic,
      fontColor: box.fontColor,
      brightness: box.brightness,
      topMargin: box.topMargin,
      sideMargin: box.sideMargin,
      transparent: box.transparent,
      label: box.label,
      monitorFontSizePx: box.monitorFontSizePx,
    })),
  );

/**
 * Resolve the full-frame background media for one display snapshot.
 * Local capture wins over file video when both are present.
 */
export const resolveLaneBackgroundMedia = ({
  boxes,
  showBackground,
  shouldPlayVideo,
  localVideoInput,
  resolvedFileVideoUrl,
}: {
  boxes: Box[];
  showBackground: boolean;
  shouldPlayVideo: boolean;
  localVideoInput?: LocalVideoInputPresentation;
  /** Already-resolved local/cloud playback URL for the current file-video box. */
  resolvedFileVideoUrl?: string;
}): LaneBackgroundMedia => {
  if (localVideoInput) {
    return { kind: "localVideo", input: localVideoInput };
  }

  if (!showBackground || !shouldPlayVideo) {
    return NONE_LANE_BACKGROUND_MEDIA;
  }

  const videoBox = boxes.find(
    (box) => box.mediaInfo?.type === "video" && box.mediaInfo?.background,
  );
  if (!videoBox?.mediaInfo) return NONE_LANE_BACKGROUND_MEDIA;

  const mediaKey = getVideoBackgroundMediaKey(videoBox.mediaInfo);
  const originalSrc = resolvedFileVideoUrl || videoBox.mediaInfo.background;
  if (!mediaKey || !originalSrc) return NONE_LANE_BACKGROUND_MEDIA;

  return {
    kind: "fileVideo",
    mediaKey,
    originalSrc,
    videoBox,
    fallbackSrc:
      videoBox.mediaInfo.placeholderImage || videoBox.mediaInfo.thumbnail ||
      getVideoFallbackImage(videoBox.mediaInfo.background),
  };
};

/** Identity shared with the Electron preparation pool and playback cues. */
export const getLanePreparedMediaKey = (
  media: LaneBackgroundMedia | undefined,
): string => (media?.kind === "fileVideo" ? media.mediaKey : "none");

const getVideoFallbackImage = (url: string): string | undefined => {
  if (!url) return undefined;
  if (
    url.includes("stream.mux.com") ||
    url.includes("portable-media/video/upload")
  ) {
    // Full-frame displays use a 1920x1080 stage. A 960x540 poster is large
    // enough for that stage while keeping fallback requests bounded.
    return (
      getImageFromVideoUrl(url, { width: 960, height: 540 }) || undefined
    );
  }
  return undefined;
};
