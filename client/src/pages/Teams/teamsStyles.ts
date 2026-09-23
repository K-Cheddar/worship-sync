export const panelShellClassName =
  "rounded-xl border border-gray-700 bg-gray-950/45";

export const panelClassName = `${panelShellClassName} p-4`;

/** Fixed header area inside a panel with an inner scroll region. */
export const panelHeaderPaddingClassName = "px-4 pt-4";

/** Scrollable body inside a panel; padding keeps the scrollbar at the panel edge. */
export const panelScrollPaddingClassName = "px-4 pb-4";

/** Form scroll body: keep the final field clear of the pinned footer. */
export const panelFormScrollPaddingClassName = "px-4 pb-4";

/** Teams outlet scroll region: page scroll on mobile, height-constrained panels on desktop. */
export const teamsSectionScrollClassName =
  "teams-section-scroll scrollbar-variable flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-3 sm:p-5 lg:overflow-hidden";

/** Manager page root fills the Teams outlet column. */
export const teamsManagerPageRootClassName = "flex min-h-0 flex-1 flex-col";

/** Side-by-side list + edit form row inside Teams managers. */
export const teamsCreatePanelRowClassName =
  "flex w-full min-h-0 min-w-0 flex-1 flex-col gap-0 max-lg:relative max-lg:overflow-hidden lg:grid lg:grid-cols-2 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:transition-[grid-template-columns,column-gap] lg:ease-in-out motion-reduce:transition-none";

/** Full-height mobile detail view shared by the list, aside, and form. */
export const teamsCreatePanelMobileViewClassName =
  "max-lg:absolute max-lg:inset-0 max-lg:flex max-lg:h-full max-lg:min-h-0 max-lg:w-full max-lg:max-w-none max-lg:flex-col";

/** Mobile detail navigation animates position and visibility, never height. */
export const teamsCreatePanelMobileViewTransitionClassName =
  "max-lg:transition-[transform,opacity] max-lg:ease-out motion-reduce:transition-none";

/** Mobile detail view timing while a view is entering. */
export const teamsCreatePanelMobileViewOpenClassName = "max-lg:duration-[240ms]";

/** Mobile detail view timing while a view is leaving. */
export const teamsCreatePanelMobileViewClosedClassName = "max-lg:duration-[200ms]";

/** Active mobile detail view. */
export const teamsCreatePanelMobileViewActiveClassName =
  "max-lg:z-10 max-lg:translate-x-0 max-lg:opacity-100";

/** List view while a detail view is active. */
export const teamsCreatePanelMobileViewExitLeftClassName =
  "max-lg:pointer-events-none max-lg:z-0 max-lg:-translate-x-6 max-lg:opacity-0";

/** Detail view while returning to the list or another detail view. */
export const teamsCreatePanelMobileViewExitRightClassName =
  "max-lg:pointer-events-none max-lg:z-0 max-lg:translate-x-6 max-lg:opacity-0";

/** Desktop layout timing when a list-side panel is opening. */
export const teamsCreatePanelRowOpenClassName = "lg:gap-4 lg:duration-300";

/** Desktop layout timing when all list-side panels are closing. */
export const teamsCreatePanelRowClosedClassName = "lg:gap-0 lg:duration-[220ms]";

/** List column; the grid track coordinates its desktop size with the form panels. */
export const teamsCreatePanelListClassName = "lg:min-w-0 lg:mx-auto lg:max-w-3xl";

/** Edit form column beside the list. */
export const teamsCreatePanelFormClassName = "lg:min-w-0 lg:flex-1 lg:max-w-xl";

/** Teams list/form panels that scroll internally and fill the content column. */
export const teamsPanelMaxHeightClassName =
  "min-h-0 flex-1 max-lg:max-h-none lg:min-h-0 lg:flex-1";

/** Schedule tab fills the Teams outlet and stacks the selector above the workspace. */
export const scheduleTabRootClassName =
  "flex flex-col gap-4 max-lg:flex-none lg:min-h-0 lg:flex-1";

/** Schedule workspace tabs fill remaining height below the selector. */
export const scheduleWorkspaceTabsClassName =
  "flex w-full flex-col gap-0 max-lg:flex-none lg:min-h-0 lg:flex-1";

/** Team schedule panel grows below title/actions with internal scroll regions. */
export const scheduleWorkspacePanelClassName =
  "mt-4 flex flex-col overflow-hidden max-lg:flex-none lg:min-h-0 lg:flex-1";

/** Grid + members row inside the team schedule panel. */
export const scheduleWorkspaceBodyRowClassName =
  "mt-4 flex flex-col gap-4 max-lg:flex-none lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch";

/** Main column for the schedule grid. */
export const scheduleWorkspaceMainColumnClassName =
  "flex min-w-0 flex-col max-lg:flex-none lg:min-h-0 lg:flex-1";

/** TabsContent body that grows inside the schedule workspace. */
export const scheduleWorkspaceTabContentClassName =
  "flex min-w-0 flex-col outline-none max-lg:flex-none lg:min-h-0 lg:flex-1";

/** Schedule grid scrollport; grows with the workspace while the bordered frame hugs the table. */
export const scheduleGridScrollClassName =
  "scrollbar-variable min-h-0 min-w-0 overflow-auto max-lg:max-h-none lg:min-h-0 lg:flex-1";

/** Border frame sized to the schedule table, not the full scrollport. */
export const scheduleGridFrameClassName =
  "w-max rounded-lg border border-gray-800";

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

/** Church mic catalog tiles — as many columns as the panel width allows. */
export const microphoneCatalogGridClassName =
  "grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] content-start gap-2";

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
