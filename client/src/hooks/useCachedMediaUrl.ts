import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store/store";
import { isLocalMediaReferenceUrl } from "../utils/localMediaReferenceUrl";

const resolveMediaUrl = async (url: string): Promise<string | undefined> => {
  if (isLocalMediaReferenceUrl(url)) return undefined;
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
  const safeUrl = isLocalMediaReferenceUrl(url) ? undefined : url;
  const cachedUrl = useSelector((state: RootState) =>
    safeUrl ? state.mediaCacheMap?.map?.[safeUrl] : undefined,
  );
  const [resolved, setResolved] = useState<string | undefined>(safeUrl);
  const checkIdRef = useRef(0);

  useEffect(() => {
    if (!safeUrl || !window.electronAPI) {
      setResolved(safeUrl);
      return;
    }
    if (cachedUrl) return;

    const checkId = ++checkIdRef.current;
    // Optimistically switch to the new asset immediately so we never
    // keep rendering the previously-resolved image while Electron checks
    // whether a better local path exists for the current URL.
    setResolved(safeUrl);

    resolveMediaUrl(safeUrl).then((result) => {
      if (checkId !== checkIdRef.current) return;
      setResolved(result);
    });
  }, [safeUrl, cachedUrl]);

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
  const safeUrl = isLocalMediaReferenceUrl(url) ? undefined : url;
  const cachedUrl = useSelector((state: RootState) =>
    safeUrl ? state.mediaCacheMap?.map?.[safeUrl] : undefined,
  );
  const [state, setState] = useState<{
    resolved: string | undefined;
    forUrl: string | undefined;
  }>({ resolved: undefined, forUrl: undefined });
  const checkIdRef = useRef(0);

  useEffect(() => {
    if (!safeUrl) {
      setState({ resolved: undefined, forUrl: undefined });
      return;
    }
    if (!window.electronAPI) {
      setState({ resolved: safeUrl, forUrl: safeUrl });
      return;
    }
    if (cachedUrl) return;

    const checkId = ++checkIdRef.current;
    setState({ resolved: undefined, forUrl: safeUrl });

    resolveMediaUrl(safeUrl).then((result) => {
      if (checkId !== checkIdRef.current) return;
      setState({ resolved: result, forUrl: safeUrl });
    });
  }, [safeUrl, cachedUrl]);

  if (cachedUrl) return cachedUrl;
  if (state.forUrl !== safeUrl) return undefined;
  return state.resolved;
};
