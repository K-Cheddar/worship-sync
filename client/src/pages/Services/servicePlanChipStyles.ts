/**
 * Shared chrome for the attachment chips on a plan element (song, scripture).
 * Kept out of ServicePlanElementRow so the popovers the row opens can use the
 * same colors without importing the row back.
 */

/** Compact attachment chips (song / scripture) on the second row. */
export const SERVICE_PLAN_ATTACHMENT_CHIP_CLASS =
  "flex items-center gap-0.5 rounded border px-1.5 py-0 text-[11px] leading-5";

export const SERVICE_PLAN_SONG_ICON_CLASS = "text-cyan-400";
export const SERVICE_PLAN_SONG_CHIP_CLASS = "border-cyan-500/50 text-cyan-50";

/**
 * A song named by the plan that isn't linked to a library song yet — usually an
 * import whose title found no match. Dashed and amber rather than solid cyan,
 * and labelled in words too, so the difference doesn't rest on color alone.
 */
export const SERVICE_PLAN_UNLINKED_SONG_CHIP_CLASS =
  "border-dashed border-amber-400/60 text-amber-50";
export const SERVICE_PLAN_UNLINKED_SONG_ICON_CLASS = "text-amber-300";

export const SERVICE_PLAN_SCRIPTURE_CHIP_CLASS =
  "border-orange-500/50 text-orange-50";
