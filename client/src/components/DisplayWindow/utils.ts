import { REFERENCE_WIDTH } from "../../constants";

/** Normalize lyric text for same-slide transition comparisons. */
export const normalizeDisplayWords = (words?: string) =>
  (words ?? "").trim().replace(/\n{2,}/g, "\n");

/**
 * True when consecutive slides show the same static text, so the text layer
 * should hold instead of replaying a fade/slide.
 */
export const shouldSkipDisplayTextAnimation = (
  words?: string,
  prevWords?: string,
) => {
  const normalized = normalizeDisplayWords(words);
  const prevNormalized = normalizeDisplayWords(prevWords);
  if (normalized !== prevNormalized) return false;
  // Dynamic placeholders change visually even when the template string matches.
  if (
    normalized.includes("{{timer}}") ||
    normalized.includes("{{service-time}}") ||
    normalized.includes("\u200C")
  ) {
    return false;
  }
  return true;
};

export const getFontSize = ({
  width,
  fontSize = 15,
}: {
  width: number;
  fontSize?: number;
}) => {
  return `${((fontSize || 15) / 10) * (width / 50)}vw`;
};

/**
 * Font size in px for monitor band (reference space). Use so clock/timer scale with the view.
 */
export const getMonitorBandFontSizePx = (fontSize: number): number =>
  ((fontSize || 15) / 10) * (REFERENCE_WIDTH / 50);

export const getBorderWidth = ({
  width,
  borderWidth,
}: {
  width: number;
  borderWidth?: number;
}) => {
  return `${(borderWidth || 0) * (width / 400)}vw`;
};

export const getMargin = (margin: number | "auto" | "unset" | undefined) => {
  return typeof margin === "number" ? `${margin}%` : margin;
};

/**
 * Calculates the y position for monitor display boxes based on font size
 */
export const getMonitorBoxYPosition = (fontSize: number): number => {
  if (fontSize < 80) return 89;
  if (fontSize <= 100) return 88;
  return 86;
};
