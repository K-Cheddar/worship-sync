import { Box, ItemSlideType, MonitorLayout } from "../types";
import {
  DEFAULT_FONT_PX,
  MONITOR_BAND_CURRENT_PX,
  REFERENCE_HEIGHT,
} from "../constants";
import { getMaxLines, getNumLines } from "./textMeasurement";

const MIN_FONT_PX = 8;
const MAX_FONT_PX = 300;

/** Same normalization as display: trim and collapse back-to-back newlines so calculation matches view. */
function normalizeTextForMeasure(words: string | undefined): string {
  return (words ?? "").trim().replace(/\n{2,}/g, "\n") || " ";
}

/**
 * Returns true if the given font size (px) fits the box text within the band height.
 */
function textFitsAtFontSizePx(
  box: Box,
  words: string,
  height: number,
  fontSizePx: number,
): boolean {
  const { maxLines, lineHeight } = getMaxLines({
    fontSizePx,
    height,
    topMargin: 0,
    isBold: box.isBold,
    isItalic: box.isItalic,
  });
  const numLines = getNumLines({
    text: words,
    fontSizePx,
    lineHeight,
    width: box.width,
    sideMargin: 0,
    isBold: box.isBold,
    isItalic: box.isItalic,
  });
  return numLines <= maxLines;
}

/**
 * Find the largest font size (px) that fits the text using binary search over
 * [MIN_FONT_PX, cap], using getMaxLines/getNumLines for each probe.
 */
function measureMaxFontSizePx(
  box: Box,
  bandHeightPx: number,
  capPx: number,
): number {
  const words = normalizeTextForMeasure(box.words);
  const height = (bandHeightPx / REFERENCE_HEIGHT) * 100;
  const cap = Math.min(MAX_FONT_PX, capPx);

  let lo = MIN_FONT_PX;
  let hi = cap;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textFitsAtFontSizePx(box, words, height, mid)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Calculates the actual max font size (px) that fits each box in the band using DOM
 * measurement (same approach as overflow:fit). Last box gets priority; others are capped by it.
 * Sets monitorFontSizePx on each box so the view can apply it directly.
 */
export function formatBoxesForMonitorBand(
  boxes: Box[],
  bandHeightPx: number,
): Box[] {
  if (boxes.length === 0) return [];

  const targetFontPxInBand: number[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    targetFontPxInBand[i] = measureMaxFontSizePx(
      box,
      bandHeightPx,
      MAX_FONT_PX,
    );
  }

  const lastIdx = boxes.length - 1;
  const cap = targetFontPxInBand[lastIdx] ?? MAX_FONT_PX;

  return boxes.map((box, i) => {
    const rawPx = targetFontPxInBand[i] ?? box.fontSize ?? DEFAULT_FONT_PX;
    const fontPxInBand = Math.min(rawPx, cap);
    return { ...box, fontSize: fontPxInBand, monitorFontSizePx: fontPxInBand };
  });
}

// Use the larger band; the next band may be cut off just as before.
const MONITOR_BAND_HEIGHT_PX = MONITOR_BAND_CURRENT_PX;

export const getMonitorLayoutForSlides = (slides: ItemSlideType[]): MonitorLayout => {
  const fontSizes = slides
    .map((slide) => {
      const bandBox = slide.boxes?.[1];
      return bandBox
        ? formatBoxesForMonitorBand([bandBox], MONITOR_BAND_HEIGHT_PX)[0]?.monitorFontSizePx
        : undefined;
    })
    .filter((size): size is number => size != null);
  const sharedFontPx = fontSizes.length ? Math.min(...fontSizes) : MAX_FONT_PX;
  return { currentFontSizePx: sharedFontPx, nextFontSizePx: sharedFontPx };
};

export const stripMonitorBoxClones = (slides: ItemSlideType[]): ItemSlideType[] =>
  slides.map((slide) => {
    if (
      !("monitorCurrentBandBoxes" in slide) &&
      !("monitorNextBandBoxes" in slide)
    ) return slide;
    const { monitorCurrentBandBoxes: _current, monitorNextBandBoxes: _next, ...clean } = slide;
    return clean;
  });

/** Derives temporary band boxes from source box 1 and compact, synchronized font sizes. */
export function addMonitorFormattedToSlide(
  slide: ItemSlideType,
  layout: MonitorLayout,
): ItemSlideType {
  const sourceBox = slide.boxes?.[1];
  const derive = (fontSizePx: number) =>
    sourceBox
      ? [{ ...sourceBox, fontSize: fontSizePx, monitorFontSizePx: fontSizePx }]
      : [];
  return {
    ...slide,
    monitorCurrentBandBoxes: derive(layout.currentFontSizePx),
    monitorNextBandBoxes: derive(layout.nextFontSizePx),
  };
}

/** Renderer helper; persisted callers should store only getMonitorLayoutForSlides. */
export function addMonitorFormattedToSlides(
  slides: ItemSlideType[],
  layout: MonitorLayout,
): ItemSlideType[] {
  return slides.map((slide) => addMonitorFormattedToSlide(slide, layout));
}
