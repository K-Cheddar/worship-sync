/**
 * Opaque local-media reference schemes. These identify assets in app state but
 * must never be assigned to img/video `src` — Chromium CSP blocks them, and
 * they are not streamable URLs. Resolve to worshipsync-media:, blob:, or a
 * cloud URL first.
 */
const LOCAL_MEDIA_REFERENCE_PREFIXES = [
  "local-image://",
  "local-video-file://",
  "local-video-input://",
] as const;

const LOCAL_VIDEO_INPUT_PREFIX = "local-video-input://";

export const isLocalMediaReferenceUrl = (value: string | undefined): boolean =>
  Boolean(
    value &&
    LOCAL_MEDIA_REFERENCE_PREFIXES.some((prefix) => value.startsWith(prefix)),
  );

/** Source id from an outline/media `local-video-input://…` background reference. */
export const parseLocalVideoInputSourceId = (
  value: string | undefined,
): string | undefined => {
  if (!value?.startsWith(LOCAL_VIDEO_INPUT_PREFIX)) return undefined;
  const encoded = value.slice(LOCAL_VIDEO_INPUT_PREFIX.length);
  if (!encoded) return undefined;
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded || undefined;
  } catch {
    return encoded || undefined;
  }
};
