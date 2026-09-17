import type { Box, DisplayType } from "../../types";

export type DisplayRenderProfile = {
  supportsBackground: boolean;
  isSimpleFont: boolean;
  backgroundBrightness?: number;
};

/**
 * Visual rules shared by the settled slide thumbnail and DisplayWindow's
 * display-box lane. The thumbnail uses the historical `slide` variant.
 */
export const resolveDisplayRenderProfile = (
  displayType: DisplayType | undefined,
  boxes: Box[],
): DisplayRenderProfile => {
  const isSlide = displayType === "slide";
  const hasWords = boxes.some((box) => Boolean(box.words?.trim()));

  return {
    supportsBackground:
      displayType === "projector" ||
      displayType === "monitor" ||
      displayType === "slide" ||
      displayType === "editor",
    isSimpleFont: isSlide,
    backgroundBrightness: isSlide && hasWords ? 30 : undefined,
  };
};
