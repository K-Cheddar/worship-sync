/** Default output path after display pairing; not a hard route lock (see `sessionRouteAccess.ts`). */
export const getDisplayHomePath = (surfaceType?: string | null) => {
  const normalized = String(surfaceType || "")
    .trim()
    .toLowerCase();
  if (normalized === "monitor") return "/monitor";
  if (normalized === "stream") return "/stream";
  if (normalized === "stream-info") return "/stream-info";
  if (normalized === "credits") return "/credits";
  if (normalized === "projector-display") return "/projector";
  if (normalized === "projector") return "/projector-full";
  return "/projector-full";
};

/** After display pairing, ignore generic entry routes so we always land on the output surface. */
export const getDisplayPairingDestination = (
  returnPath: string,
  surfaceType?: string | null,
) => {
  const path = returnPath.trim();
  if (!path || path === "/" || path === "/home" || path === "/login") {
    return getDisplayHomePath(surfaceType);
  }
  return path;
};
