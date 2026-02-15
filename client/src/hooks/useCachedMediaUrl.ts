import { useEffect, useRef, useState } from "react";

/**
 * Returns a locally-cached URL for the given media URL when running in Electron,
 * or the original URL otherwise.
 *
 * Handles rapid URL changes safely — stale IPC responses are discarded.
 */
export const useCachedMediaUrl = (
  url: string | undefined
): string | undefined => {
  const [resolved, setResolved] = useState<string | undefined>(url);
  const checkIdRef = useRef(0);

  useEffect(() => {
    // Nothing to cache
    if (!url || !window.electronAPI) {
      setResolved(url);
      return;
    }

    const checkId = ++checkIdRef.current;

    (async () => {
      try {
        const localPath = await (
          window.electronAPI as unknown as {
            getLocalMediaPath: (u: string) => Promise<string | null>;
          }
        ).getLocalMediaPath(url);

        if (checkId !== checkIdRef.current) return; // stale
        setResolved(localPath || url);
      } catch {
        if (checkId !== checkIdRef.current) return;
        setResolved(url);
      }
    })();
  }, [url]);

  return resolved;
};
