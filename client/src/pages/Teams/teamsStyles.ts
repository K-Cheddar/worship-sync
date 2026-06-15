export const panelShellClassName =
  "rounded-xl border border-gray-700 bg-gray-950/45";

export const panelClassName = `${panelShellClassName} p-4`;

/** Fixed header area inside a panel with an inner scroll region. */
export const panelHeaderPaddingClassName = "px-4 pt-4";

/** Scrollable body inside a panel; padding keeps the scrollbar at the panel edge. */
export const panelScrollPaddingClassName = "px-4 pb-4";

/** Form scroll body: bottom inset comes from the sticky footer instead. */
export const panelFormScrollPaddingClassName = "px-4 pb-0";

/** Side-by-side list + edit form row inside Teams managers. */
export const teamsCreatePanelRowClassName =
  "flex w-full min-w-0 flex-col gap-4 lg:flex-row lg:items-stretch";

/** List column when the edit form is open: shares space instead of a fixed max width. */
export const teamsCreatePanelListOpenClassName =
  "lg:min-w-0 lg:flex-1 lg:max-w-2xl";

/** List column when only the list is shown. */
export const teamsCreatePanelListClosedClassName = "lg:mx-auto lg:max-w-3xl";

/** Edit form column beside the list. */
export const teamsCreatePanelFormClassName = "lg:min-w-0 lg:flex-1 lg:max-w-xl";

/** Max height for Teams list/form panels that scroll internally within the content area. */
export const teamsPanelMaxHeightClassName =
  "lg:max-h-[min(48rem,calc(100dvh-14rem))]";

/** Create/edit panel fills the Teams content column on mobile. */
export const teamsCreatePanelOpenMobileClassName =
  "max-lg:flex max-lg:min-h-0 max-lg:flex-1 max-lg:flex-col";

/** Edit form column uses remaining height on mobile instead of a viewport max-height. */
export const teamsCreatePanelFormOpenMobileClassName =
  "max-lg:min-h-0 max-lg:flex-1 max-lg:max-h-none";

/** Pinned save/cancel footer below the form scroll area. */
export const teamsFormPanelFooterClassName =
  "shrink-0 border-t border-gray-700/50 bg-gray-950/45 px-4 py-3";

/** Icon-only row actions: compact on desktop, touch-friendly on mobile. */
export const teamsRowIconButtonClassName =
  "max-md:[&_svg]:size-8 lg:p-0.5 lg:[&_svg]:size-3.5";

export const teamsRowIconButtonPadding =
  "px-2 py-1 max-md:px-2 lg:px-1 lg:py-0.5";
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
