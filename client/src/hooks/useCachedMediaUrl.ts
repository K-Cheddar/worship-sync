import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store/store";

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
 * or the original URL otherwise. Uses the Redux cache map for instant resolution when available.
 */
export const useCachedMediaUrl = (
  url: string | undefined,
): string | undefined => {
  const cachedUrl = useSelector((state: RootState) =>
    url ? state.mediaCacheMap?.map?.[url] : undefined,
  );
  const [resolved, setResolved] = useState<string | undefined>(url);
  const checkIdRef = useRef(0);

  useEffect(() => {
    if (!url || !window.electronAPI) {
      setResolved(url);
      return;
    }
    if (cachedUrl) return;

    const checkId = ++checkIdRef.current;
    // Optimistically switch to the new asset immediately so we never
    // keep rendering the previously-resolved image while Electron checks
    // whether a better local path exists for the current URL.
    setResolved(url);

    resolveMediaUrl(url).then((result) => {
      if (checkId !== checkIdRef.current) return;
      setResolved(result);
    });
  }, [url, cachedUrl]);

  return cachedUrl ?? resolved;
};

/**
 * Like useCachedMediaUrl, but returns undefined until cache resolution completes.
 * Use for videos where loading the wrong (remote) URL before the cache check
 * finishes is undesirable. Uses the Redux cache map for instant resolution when available.
 */
export const useCachedVideoUrl = (
  url: string | undefined,
): string | undefined => {
  const cachedUrl = useSelector((state: RootState) =>
    url ? state.mediaCacheMap?.map?.[url] : undefined,
  );
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
    if (cachedUrl) return;

    const checkId = ++checkIdRef.current;
    setState({ resolved: undefined, forUrl: url });

    resolveMediaUrl(url).then((result) => {
      if (checkId !== checkIdRef.current) return;
      setState({ resolved: result, forUrl: url });
    });
  }, [url, cachedUrl]);

  if (cachedUrl) return cachedUrl;
  if (state.forUrl !== url) return undefined;
  return state.resolved;
};
