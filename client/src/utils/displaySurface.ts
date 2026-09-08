import { withOutputParam } from "./displayRoutePersistence";

/**
 * Default output path after display pairing; not a hard route lock (see
 * `sessionRouteAccess.ts`).
 *
 * `surfaceType` picks the route (the render profile), and `outputId` names which
 * display on that route. A screen paired without an output falls back to the
 * built-in display for its type, which is exactly how every screen behaved
 * before outputs existed.
 */
export const getDisplayHomePath = (
  surfaceType?: string | null,
  outputId?: string | null,
) => {
  const normalized = String(surfaceType || "")
    .trim()
    .toLowerCase();
  const path = (() => {
    if (normalized === "monitor") return "/monitor";
    if (normalized === "stream") return "/stream";
    if (normalized === "stream-info") return "/stream-info";
    if (normalized === "credits") return "/credits";
    if (normalized === "projector-display") return "/projector";
    if (normalized === "projector") return "/projector-full";
    return "/projector-full";
  })();
  return withOutputParam(path, outputId);
};

/**
 * After display pairing, ignore generic entry routes so we always land on the
 * output surface. A stored return path that already names an output is kept as
 * is, so re-pairing a screen does not move it off its display.
 */
export const getDisplayPairingDestination = (
  returnPath: string,
  surfaceType?: string | null,
  outputId?: string | null,
) => {
  const path = returnPath.trim();
  if (!path || path === "/" || path === "/home" || path === "/login") {
    return getDisplayHomePath(surfaceType, outputId);
  }
  return withOutputParam(path, outputId);
};
