import { useEffect, useRef, useState } from "react";

const resolveMediaUrl = async (url: string): Promise<string> => {
  if (!window.electronAPI) return url;
  try {
    const localPath = await (
      window.electronAPI as unknown as {
        getLocalMediaPath: (u: string) => Promise<string | null>;
      }
    ).getLocalMediaPath(url);
    return localPath || url;
  } catch {
    return url;
  }
};

/**
 * Returns a locally-cached URL for the given media URL when running in Electron,
 * or the original URL otherwise.
 *
 * Returns the raw URL immediately while resolving — suitable for images where
 * showing the remote URL briefly is acceptable.
 */
export const useCachedMediaUrl = (
  url: string | undefined,
): string | undefined => {
  const [resolved, setResolved] = useState<string | undefined>(url);
  const checkIdRef = useRef(0);

  useEffect(() => {
    if (!url || !window.electronAPI) {
      setResolved(url);
      return;
    }

    const checkId = ++checkIdRef.current;

    resolveMediaUrl(url).then((result) => {
      if (checkId !== checkIdRef.current) return;
      setResolved(result);
    });
  }, [url]);

  return resolved;
};

/**
 * Like useCachedMediaUrl, but returns undefined until cache resolution completes.
 * Use for videos where loading the wrong (remote) URL before the cache check
 * finishes is undesirable.
 */
export const useCachedVideoUrl = (
  url: string | undefined,
): string | undefined => {
  const [state, setState] = useState<{
    resolved: string | undefined;
    forUrl: string | undefined;
  }>({ resolved: undefined, forUrl: undefined });
  const checkIdRef = useRef(0);

  useEffect(() => {
    if (!url) {
      setState({ resolved: undefined, forUrl: undefined });
      return;
    }
    if (!window.electronAPI) {
      setState({ resolved: url, forUrl: url });
      return;
    }

    const checkId = ++checkIdRef.current;
    setState({ resolved: undefined, forUrl: url });

    resolveMediaUrl(url).then((result) => {
      if (checkId !== checkIdRef.current) return;
      setState({ resolved: result, forUrl: url });
    });
  }, [url]);

  // Stale guard: if url changed but the effect hasn't updated state yet,
  // return undefined instead of the previous video's resolved URL.
  if (state.forUrl !== url) return undefined;
  return state.resolved;
};
