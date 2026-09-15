/**
 * Sources that can decode from local bytes without a network start.
 * Used to decide whether a still poster is only a brief Electron flash guard
 * versus an expected streaming fallback.
 */
export const isInstantVideoSource = (src?: string | null): boolean => {
  if (!src) return false;
  return (
    src.startsWith("media-cache://") ||
    src.startsWith("worshipsync-media://") ||
    src.startsWith("blob:")
  );
};

/** HLS manifests are live/segmented streams and should keep conservative preload behavior. */
export const isHLSVideoSource = (src?: string | null): boolean => {
  if (!src) return false;
  return src.toLowerCase().split(/[?#]/, 1)[0].endsWith(".m3u8");
};

export type VideoSourceKind = "cache" | "local" | "network" | "hls" | "unknown";

export const getVideoSourceKind = (src?: string | null): VideoSourceKind => {
  if (!src) return "unknown";
  if (isHLSVideoSource(src)) return "hls";
  if (src.startsWith("media-cache://")) return "cache";
  if (src.startsWith("worshipsync-media://") || src.startsWith("blob:")) {
    return "local";
  }
  if (/^(?:https?:)?\/\//i.test(src)) return "network";
  return "unknown";
};

/**
 * Finite output videos can buffer ahead for a clean handoff. Controller
 * previews stay conservative because several tiles may be mounted at once.
 * Local/cache sources are already available without a network request, while
 * HLS remains metadata-only because it is segmented/live media.
 */
export const getVideoPreload = (
  src?: string | null,
  role?: "preview" | "output",
): "auto" | "metadata" => {
  if (isHLSVideoSource(src)) return "metadata";
  if (isInstantVideoSource(src)) return "auto";
  return role === "output" ? "auto" : "metadata";
};
