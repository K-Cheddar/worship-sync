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
