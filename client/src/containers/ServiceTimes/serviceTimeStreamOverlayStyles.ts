/** Shape + typography shared by stream-info overlay and Service Times previews. */
export const serviceTimeOverlayContentClassName =
  "rounded-[5%_/_10%] font-semibold select-none flex flex-col items-center justify-center text-center";

/** Vertical space between “… begins in” and the countdown when `includeNameTimeGap` is true. */
export const serviceTimeOverlayContentGapClassName = "gap-y-3";

/**
 * `/stream-info` overlay: the face sits inside a shrink-wrapped `absolute` wrapper, so `%` padding
 * would resolve against a tiny width. Use vw so padding matches the old full-viewport look.
 */
export const serviceTimeOverlayStreamInfoPaddingClassName =
  "px-[1vw] py-[0.5vw]";

/**
 * Service Times aspect preview: same **ratio** as stream (`0.5` / `1` vertical / horizontal vs
 * reference width), but `cqw` is % of the **preview box**, which is usually much narrower than the
 * browser viewport—so literal `0.5cqw` / `1cqw` reads tighter than `0.5vw` / `1vw` on stream-info.
 * These multipliers bring the in-preview pill padding in line with how stream-info reads on a
 * typical operator display (requires a `container-type` ancestor, e.g. `@container` on the frame).
 */
export const serviceTimePreviewFramePaddingStyle = {
  padding: "0.75cqw 1.5cqw",
} as const;
