/**
 * Shared chrome for the attachment chips on a plan element (song, scripture).
 * Kept out of ServicePlanElementRow so the popovers the row opens can use the
 * same colors without importing the row back.
 */

/** Compact attachment chips — fixed rem on small screens (fluid `h-8` shrinks).
 * `leading-none` keeps label + remove icon optically centered in the fixed height;
 * line-height struts from `leading-5`/`leading-6` sat content high in the pill. */
export const SERVICE_PLAN_ATTACHMENT_CHIP_CLASS =
  "box-border flex h-7 max-h-7 min-h-0 items-center gap-0.5 rounded border px-1.5 py-0 text-xs max-md:text-sm font-normal leading-none max-md:h-[2rem] max-md:max-h-[2rem]";

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
  "border-violet-500/50 text-violet-50";

/** Controller-only resource pills retain their compact, wrapping layout. */
export const getControllerServicePlanResourcePillClass = (type: string): string => {
  const layout = "inline-flex min-w-0 max-w-full items-center gap-1 whitespace-normal rounded-full border px-2 py-0.5 text-left text-xs leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
  if (type === "song") {
    return `${layout} border-cyan-400/60 bg-cyan-950/60 text-cyan-50 hover:border-cyan-300 hover:bg-cyan-900/60 focus-visible:ring-cyan-300`;
  }
  if (type === "scripture") {
    return `${layout} border-violet-400/60 bg-violet-950/60 text-violet-50 hover:border-violet-300 hover:bg-violet-900/60 focus-visible:ring-violet-300`;
  }
  return `${layout} border-neutral-500 bg-neutral-900 text-neutral-100 hover:border-neutral-300 hover:bg-neutral-800 focus-visible:ring-neutral-200`;
};
