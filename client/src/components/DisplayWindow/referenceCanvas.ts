import { REFERENCE_HEIGHT, REFERENCE_WIDTH } from "../../constants";

/** Uniformly scales reference-space content into the available viewport. */
export const calculateReferenceScaleFactor = (
  availableWidth: number,
  availableHeight: number,
) => {
  if (availableWidth <= 0 || availableHeight <= 0) return 0;
  return Math.min(
    availableWidth / REFERENCE_WIDTH,
    availableHeight / REFERENCE_HEIGHT,
  );
};
