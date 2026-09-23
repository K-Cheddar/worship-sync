import { getFileExtension } from "./mediaFileTypes";
import { isHLSVideoSource } from "./isInstantVideoSource";

export type PreparedVideoCacheEntry = {
  source: string;
  sourceUrl?: string;
  contentType?: string | null;
};

export type PreparedVideoSource = PreparedVideoCacheEntry & {
  sourceType: "cached finite video";
};

export const PREPARED_VIDEO_EMPTY_STATE_MESSAGE =
  "No eligible cached finite videos found. Open or cache a service or media library containing videos, then select Refresh cache.";

const SUPPORTED_FINITE_VIDEO_EXTENSIONS = new Set([
  "m4v",
  "mp4",
  "ogv",
  "webm",
]);

const SUPPORTED_FINITE_VIDEO_CONTENT_TYPES = new Set([
  "video/mp4",
  "video/ogg",
  "video/webm",
  "video/x-m4v",
]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpe",
  "jpeg",
  "jpg",
  "jxl",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

const CAPTURE_SOURCE_PATTERN = /^(?:capture|desktop-capture|screen|window|local-video-input):/i;

const normalizedContentType = (contentType?: string | null): string =>
  contentType?.split(";", 1)[0].trim().toLowerCase() || "";

const sourceExtension = (entry: PreparedVideoCacheEntry): string => {
  const source = entry.sourceUrl || entry.source;
  return getFileExtension(source.split(/[?#]/, 1)[0]);
};

export const isEligiblePreparedVideoSource = (
  entry: PreparedVideoCacheEntry,
): boolean => {
  const contentType = normalizedContentType(entry.contentType);
  const extension = sourceExtension(entry);

  if (
    !entry.source.startsWith("media-cache://") ||
    isHLSVideoSource(entry.source) ||
    isHLSVideoSource(entry.sourceUrl) ||
    CAPTURE_SOURCE_PATTERN.test(entry.source) ||
    CAPTURE_SOURCE_PATTERN.test(entry.sourceUrl || "")
  ) {
    return false;
  }

  // Do not let a stale or incorrect cache MIME type turn a known image into a
  // video experiment candidate. The cache filename is the actual local file.
  if (IMAGE_EXTENSIONS.has(extension) || contentType.startsWith("image/")) {
    return false;
  }

  if (contentType) {
    return SUPPORTED_FINITE_VIDEO_CONTENT_TYPES.has(contentType);
  }

  // Older cache indexes may not have stored contentType. In that case the
  // local filename is the only useful metadata available to the renderer.
  return SUPPORTED_FINITE_VIDEO_EXTENSIONS.has(extension);
};

export const resolvePreparedVideoSources = (
  entries: PreparedVideoCacheEntry[],
): PreparedVideoSource[] => {
  const seen = new Set<string>();
  return entries.filter(isEligiblePreparedVideoSource).reduce<PreparedVideoSource[]>(
    (sources, entry) => {
      if (seen.has(entry.source)) return sources;
      seen.add(entry.source);
      sources.push({ ...entry, sourceType: "cached finite video" });
      return sources;
    },
    [],
  );
};

export const selectPreparedVideoSources = (
  sources: PreparedVideoSource[],
  count: number,
): PreparedVideoSource[] => sources.slice(0, Math.max(0, count));

export const getPreparedVideoSourceLabel = (
  entry: PreparedVideoSource,
): string => {
  const contentType = normalizedContentType(entry.contentType);
  return contentType || `${sourceExtension(entry).toUpperCase()} video`;
};
