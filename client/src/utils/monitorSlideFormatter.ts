import { Box, ItemSlideType } from "../types";
import {
  DEFAULT_FONT_PX,
  MONITOR_BAND_CURRENT_PX,
  MONITOR_BAND_NEXT_PX,
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

/** Use the smaller band height so both bands get the same font size. */
const MONITOR_BAND_HEIGHT_PX = Math.min(
  MONITOR_BAND_CURRENT_PX,
  MONITOR_BAND_NEXT_PX,
);

function applyFixedFontToBoxes(boxes: Box[], fontPx: number): Box[] {
  return boxes.map((box) => ({
    ...box,
    fontSize: fontPx,
    monitorFontSizePx: fontPx,
  }));
}

/** Bands only render box at index 1 (main content). */
export function addMonitorFormattedToSlide(
  slide: ItemSlideType,
  fixedFontPx?: number,
): ItemSlideType {
  const boxes = slide.boxes ?? [];
  const bandBox = boxes[1];
  if (!bandBox) {
    return { ...slide, monitorCurrentBandBoxes: [], monitorNextBandBoxes: [] };
  }
  const formatted =
    fixedFontPx !== undefined
      ? applyFixedFontToBoxes([bandBox], fixedFontPx)
      : formatBoxesForMonitorBand([bandBox], MONITOR_BAND_HEIGHT_PX);
  return {
    ...slide,
    monitorCurrentBandBoxes: formatted,
    monitorNextBandBoxes: formatted,
  };
}

export function addMonitorFormattedToSlides(
  slides: ItemSlideType[],
): ItemSlideType[] {
  const fontSizes = slides
    .map((slide) => {
      const boxes = slide.boxes ?? [];
      const bandBox = boxes[1];
      if (!bandBox) return null;
      const formatted = formatBoxesForMonitorBand(
        [bandBox],
        MONITOR_BAND_HEIGHT_PX,
      );
      return formatted[0]?.monitorFontSizePx ?? null;
    })
    .filter((p): p is number => p != null);

  const minFontPx = fontSizes.length > 0 ? Math.min(...fontSizes) : MAX_FONT_PX;

  return slides.map((slide) => addMonitorFormattedToSlide(slide, minFontPx));
}
