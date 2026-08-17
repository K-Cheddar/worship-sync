import type { WindowStatesInfo, WindowType } from "../types/electron";

/** Whether the given Electron output window currently exists (from main-process state). */
export const isElectronDisplayWindowOpen = (
  isElectron: boolean,
  windowStates: WindowStatesInfo | null | undefined,
  windowType: WindowType,
): boolean => {
  if (!isElectron || !windowStates) return false;
  return windowStates.displays?.[windowType]?.isOpen ?? false;
};

/**
 * Saved state for one window, or an empty state when it has never been opened.
 *
 * A window key now comes from the display registry, so the renderer asks about
 * displays the main process may never have shown.
 */
export const getElectronWindowState = (
  windowStates: WindowStatesInfo | null | undefined,
  windowType: WindowType,
) => windowStates?.displays?.[windowType];
