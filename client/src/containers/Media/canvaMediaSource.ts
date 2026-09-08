import type { CanvaMediaSource, MediaType } from "../../types";

const IMPORT_KEY_PATTERN =
  /^canva:([A-Za-z0-9_-]{3,200}):rev:(\d+):(png|mp4):([0-9,]+)$/;

const normalizePages = (values: readonly number[]) =>
  [...new Set(values)]
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= 500)
    .sort((a, b) => a - b);

export const parseCanvaImportKey = (
  importKey: string | undefined,
): CanvaMediaSource | null => {
  const match = String(importKey || "").match(IMPORT_KEY_PATTERN);
  if (!match) return null;
  const pageNumbers = normalizePages(match[4].split(",").map(Number));
  if (!pageNumbers.length) return null;
  return {
    designId: match[1],
    designTitle: "Canva design",
    revision: Number(match[2]),
    format: match[3] as CanvaMediaSource["format"],
    pageNumbers,
  };
};

export const getCanvaMediaSource = (
  media: Pick<MediaType, "canvaImportKey" | "canvaSource">,
): CanvaMediaSource | null => media.canvaSource || parseCanvaImportKey(media.canvaImportKey);

export const canvaSourcesMatch = (
  left: CanvaMediaSource,
  right: CanvaMediaSource,
) =>
  left.designId === right.designId &&
  left.format === right.format &&
  normalizePages(left.pageNumbers).join(",") ===
    normalizePages(right.pageNumbers).join(",");

export const isCanvaSourceCurrent = (
  source: CanvaMediaSource,
  currentRevision: number | string,
) => source.revision >= (Number(currentRevision) || 0);
