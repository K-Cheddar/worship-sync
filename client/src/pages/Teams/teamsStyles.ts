export const panelClassName =
  "rounded-xl border border-gray-700 bg-gray-950/45 p-4";
export const inputStackClassName = "min-w-0 w-full";

export const boardDarkFieldClassName =
  "rounded-md border border-stone-600 bg-stone-900 text-stone-100 caret-amber-400 placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40";
export const boardFieldLabelClassName = "text-stone-200";
export const boardHeaderClassName =
  "shrink-0 rounded-xl border border-stone-700 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),transparent_45%),linear-gradient(135deg,rgba(41,37,36,0.98),rgba(12,10,9,0.95))] p-6 shadow-2xl";
export const boardFormSectionClassName =
  "rounded-xl border border-stone-700 bg-stone-900/95 p-4 sm:p-5";
/** Intake public form: one fewer box around the fields. */
export const boardIntakeFormSectionClassName =
  "rounded-xl bg-stone-900/60 p-4 sm:p-5";
export const boardFieldsetClassName =
  "space-y-2 rounded-xl border border-stone-700 bg-stone-900/85 p-4";
/** Intake public form field groups: legend + content, no extra frame. */
export const boardIntakeFieldsetClassName = "space-y-2";
export const boardFieldsetLegendClassName =
  "px-1 text-sm font-semibold text-stone-200";
export const boardFieldsetDescriptionClassName = "px-1 text-sm text-stone-400";

/** Public attendee pages: #root/body use overflow hidden, so the page shell must scroll. */
export const publicPageScrollClassName =
  "h-dvh min-h-0 overflow-y-auto overscroll-y-contain";

export const boardPublicPageClassName = `${publicPageScrollClassName} bg-stone-950 px-4 py-4 pb-8 text-white`;
