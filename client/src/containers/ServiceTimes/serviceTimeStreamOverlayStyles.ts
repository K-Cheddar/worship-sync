/**
 * vw font sizes for the stream / service-time preview overlay (matches StreamPreview).
 */
export const getServiceTimeOverlayFontSizesVw = (
  nameSize: number,
  timeSize: number,
) => {
  const nameFontSize = nameSize / 10 / (100 / 50);
  const timeFontSize = timeSize / 10 / (100 / 50);
  return { nameFontSize, timeFontSize };
};

/** Shape + typography shared by stream preview, stream-info overlay, and info-controller countdown. */
export const serviceTimeOverlayContentClassName =
  "rounded-[5%_/_10%] font-semibold select-none flex flex-col items-center justify-center text-center";

/** Vertical space between “… begins in” and the countdown (info controller + edit preview). */
export const serviceTimeOverlayContentGapClassName = "gap-y-3";

/**
 * Padding for the **aspect-video edit preview** only. Percentages resolve against the preview box.
 */
export const serviceTimeOverlayViewportFractionalPaddingClassName =
  "px-[1%] py-[0.5%]";

/**
 * `/stream-info` overlay: the face sits inside a shrink-wrapped `absolute` wrapper, so `%` padding
 * would resolve against a tiny width. Use vw so padding matches the old full-viewport look.
 */
export const serviceTimeOverlayStreamInfoPaddingClassName =
  "px-[1vw] py-[0.5vw]";

/**
 * Padding matched to stream-info behavior: 1% / 0.5% of the viewport there ≈ 1vw / 0.5vw here,
 * with a floor so small viewports still get comfortable padding in the info controller.
 */
export const serviceTimeOverlayPanelPaddingClassName =
  "px-[max(1rem,1vw)] py-[max(0.625rem,0.5vw)]";
