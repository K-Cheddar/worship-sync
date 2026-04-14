import type { WindowType } from "../types/electron";

/**
 * Maps the current app path to the Electron display window type that owns it,
 * when the route is opened in a dedicated display window (projector, monitor, board).
 */
export const getElectronDisplayWindowTypeFromPathname = (
  pathname: string
): WindowType | null => {
  if (pathname === "/projector" || pathname.startsWith("/projector")) {
    return "projector";
  }
  if (pathname === "/monitor" || pathname.startsWith("/monitor")) {
    return "monitor";
  }
  if (pathname.startsWith("/boards")) {
    return "board";
  }
  return null;
};
