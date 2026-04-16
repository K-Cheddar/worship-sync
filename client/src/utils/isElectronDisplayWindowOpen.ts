import type { WindowStatesInfo, WindowType } from "../types/electron";

/** Whether the given Electron output window currently exists (from main-process state). */
export const isElectronDisplayWindowOpen = (
  isElectron: boolean,
  windowStates: WindowStatesInfo | null | undefined,
  windowType: WindowType,
): boolean => {
  if (!isElectron || !windowStates) return false;
  if (windowType === "board") return windowStates.boardOpen;
  if (windowType === "monitor") return windowStates.monitorOpen;
  return windowStates.projectorOpen;
};
