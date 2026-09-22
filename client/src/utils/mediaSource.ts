import { isLocalMediaReferenceUrl } from "./localMediaReferenceUrl";

export type MediaSourceClassification = "opaque-reference" | "playable";

/**
 * A persisted media reference identifies an asset but is not a Chromium media
 * URL. Keep this distinction at the presentation boundary so individual
 * players do not each grow their own scheme checks.
 */
export const classifyMediaSource = (
  source: string | undefined | null,
): MediaSourceClassification => {
  if (!source || isLocalMediaReferenceUrl(source)) return "opaque-reference";
  if (
    source.startsWith("worshipsync-media://") ||
    source.startsWith("media-cache://") ||
    source.startsWith("blob:") ||
    source.startsWith("data:") ||
    source.startsWith("file:") ||
    /^https?:\/\//i.test(source)
  ) {
    return "playable";
  }
  return "opaque-reference";
};

export const isPlayableMediaSource = (source: string | undefined | null) =>
  classifyMediaSource(source) === "playable";

/** Development guard for the final HTMLMediaElement assignment boundary. */
export const assignPlayableVideoSource = (
  video: HTMLVideoElement,
  source: string,
  details: {
    mediaKey?: string;
    renderer?: string;
    path?: string;
  } = {},
): boolean => {
  if (!isPlayableMediaSource(source)) {
    if (import.meta.env.DEV) {
      console.error("[media-source] Opaque media reference reached playback boundary", {
        mediaKey: details.mediaKey,
        source,
        renderer: details.renderer,
        path: details.path,
      });
    }
    return false;
  }
  video.src = source;
  return true;
};
