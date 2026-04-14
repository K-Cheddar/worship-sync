import type { MediaType } from "../../types";

/**
 * Drops the leading path segment (e.g. Cloudinary upload folder prefix) for
 * persisted display names. Trims surrounding whitespace.
 */
export function normalizeMediaLibraryStoredName(name: string): string {
  const t = name.trim();
  if (!t) return t;
  return t.includes("/") ? t.split("/").slice(1).join("/") : t;
}

/** File-style label without leading folder path segments (matches media action bar header). */
export function mediaLibraryDisplayName(m: { name: string }): string {
  return normalizeMediaLibraryStoredName(m.name);
}

/** Short label for toasts (ellipsis when long so copy stays readable). */
const DEFAULT_MEDIA_TOAST_LABEL_MAX_CHARS = 36;

export function truncatedMediaToastLabel(
  m: { name: string },
  maxChars: number = DEFAULT_MEDIA_TOAST_LABEL_MAX_CHARS,
): string {
  const display = mediaLibraryDisplayName(m);
  if (display.length <= maxChars) return display;
  if (maxChars <= 1) return "…";
  return `${display.slice(0, maxChars - 1)}…`;
}

function hasPixelDimensions(m: MediaType): boolean {
  const { width, height } = m;
  return (
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
  );
}

/** Secondary line: dimensions, format, duration, source, fps — omit missing values. */
export function formatMediaDimensionsLine(m: MediaType): string {
  const parts: string[] = [];
  if (hasPixelDimensions(m)) {
    parts.push(`${m.width}×${m.height}`);
  }
  if (m.format) parts.push(m.format);
  if (m.type === "video" && m.duration != null && Number.isFinite(m.duration)) {
    parts.push(`${Math.round(m.duration)}s`);
  }
  if (m.source) parts.push(m.source);
  if (m.frameRate != null && Number.isFinite(m.frameRate)) {
    parts.push(`${m.frameRate} fps`);
  }
  return parts.join(" · ");
}

export function summarizeMultiSelectMetadata(items: MediaType[]): string {
  if (items.length === 0) return "";
  const dimLabels = items
    .filter(hasPixelDimensions)
    .map((i) => `${i.width}×${i.height}`);
  const dims = new Set(dimLabels);
  const fmts = new Set(items.map((i) => i.format).filter(Boolean));
  const types = new Set(items.map((i) => i.type));
  const parts: string[] = [];
  if (dimLabels.length > 0) {
    if (dims.size === 1) parts.push([...dims][0]);
    else parts.push("Various dimensions");
  }
  if (fmts.size === 1) parts.push([...fmts][0] as string);
  else if (fmts.size > 1) parts.push("Mixed formats");
  if (types.size === 1) parts.push([...types][0]);
  return parts.join(" · ");
}
