import { Box } from "../../types";

export const getFontSize = ({
  width,
  fontSize = 15,
}: {
  width: number;
  fontSize?: number;
}) => {
  return `${((fontSize || 15) / 10) * (width / 50)}vw`;
};

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
  if (fontSize < 15) return 90;
  if (fontSize < 20) return 88;
  if (fontSize < 25) return 86;
  return 84;
};

/**
 * Creates a monitor display box with common properties
 */
export const createMonitorDisplayBox = ({
  id,
  words,
  x,
  fontSize,
  fontColor = "#ffffff",
  align = "left",
}: {
  id: string;
  words: string;
  x: number;
  fontSize: number;
  fontColor?: string;
  align?: "left" | "right" | "center";
}): Box => {
  return {
    id,
    words,
    width: 40,
    height: 10,
    x,
    y: getMonitorBoxYPosition(fontSize),
    fontSize: fontSize / 10,
    fontColor,
    align,
  };
};
