import type { WindowType } from "../types/electron";

/** Matches the output id validation the pairing API and main process apply. */
const OUTPUT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The surface a display route renders, ignoring which display it points at.
 */
const getSurfaceFromPathname = (pathname: string): WindowType | null => {
  if (pathname.startsWith("/projector")) return "projector";
  if (pathname.startsWith("/monitor")) return "monitor";
  if (pathname.startsWith("/stream")) return "stream";
  if (pathname.startsWith("/boards")) return "board";
  return null;
};

/**
 * The Electron window key that owns the current route.
 *
 * Window keys are output ids, and a route names its display in `?output=`.
 * Deriving the key from the pathname alone collapsed every projector onto the
 * built-in one, so closing a blocked Lobby window would have closed the live
 * main projector instead.
 */
export const getElectronDisplayWindowKeyFromLocation = (
  pathname: string,
  search?: string,
): WindowType | null => {
  const surface = getSurfaceFromPathname(pathname);
  if (!surface) return null;
  const requested = new URLSearchParams(search ?? "").get("output");
  if (requested && OUTPUT_ID_PATTERN.test(requested)) return requested;
  return surface;
};
