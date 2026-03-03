import { REFERENCE_WIDTH } from "../../constants";

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
