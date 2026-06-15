/** Tailwind `lg` breakpoint — keep in sync with controller side panels. */
export const CONTROLLER_LG_BREAKPOINT_PX = 1024;

/** Right panel width when open on viewports below `lg` (see Controller.tsx). */
export const CONTROLLER_RIGHT_PANEL_WIDTH_MOBILE_PERCENT = 65;

/** Right panel width on `lg` and up (see Controller.tsx). */
export const CONTROLLER_RIGHT_PANEL_WIDTH_DESKTOP_PERCENT = 25;

export const getControllerRightPanelWidthPx = (viewportWidth: number): number => {
  const percent =
    viewportWidth >= CONTROLLER_LG_BREAKPOINT_PX
      ? CONTROLLER_RIGHT_PANEL_WIDTH_DESKTOP_PERCENT
      : CONTROLLER_RIGHT_PANEL_WIDTH_MOBILE_PERCENT;
  return Math.round((viewportWidth * percent) / 100);
};
