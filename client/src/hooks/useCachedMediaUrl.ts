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

const MAX_RESOLVED_MEDIA_URLS = 128;
const resolvedByUrl = new Map<string, string>();
const inFlightByUrl = new Map<string, Promise<string | undefined>>();

const rememberResolvedUrl = (url: string, resolvedUrl: string) => {
  // Keep the most recently used URLs. Continuous mode supplies the lifecycle
  // bound for image elements; this bound prevents the resolution map itself
  // from growing with a long-lived service or many opened services.
  resolvedByUrl.delete(url);
  resolvedByUrl.set(url, resolvedUrl);
  while (resolvedByUrl.size > MAX_RESOLVED_MEDIA_URLS) {
    const oldestUrl = resolvedByUrl.keys().next().value;
    if (oldestUrl === undefined) break;
    resolvedByUrl.delete(oldestUrl);
  }
};

const peekResolvedMediaUrl = (url: string): string | undefined =>
  resolvedByUrl.get(url);

const getResolvedMediaUrl = (url: string): string | undefined => {
  const resolvedUrl = peekResolvedMediaUrl(url);
  if (resolvedUrl === undefined) return undefined;
  // A successful lookup is also a use, so make it the newest bounded entry.
  rememberResolvedUrl(url, resolvedUrl);
  return resolvedUrl;
};

const resolveSharedMediaUrl = (url: string): Promise<string | undefined> => {
  const resolvedUrl = getResolvedMediaUrl(url);
  if (resolvedUrl !== undefined) return Promise.resolve(resolvedUrl);

  const inFlight = inFlightByUrl.get(url);
  if (inFlight) return inFlight;

  const request = resolveMediaUrl(url).then((result) => {
    if (result !== undefined) rememberResolvedUrl(url, result);
    return result;
  });
  inFlightByUrl.set(url, request);
  void request.finally(() => {
    if (inFlightByUrl.get(url) === request) inFlightByUrl.delete(url);
  });
  return request;
};

/** Test-only reset for the module-level cache. */
export const clearMediaResolutionCacheForTests = () => {
  resolvedByUrl.clear();
  inFlightByUrl.clear();
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
  const [resolved, setResolved] = useState<string | undefined>(() =>
    safeUrl ? peekResolvedMediaUrl(safeUrl) ?? safeUrl : undefined,
  );
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

    void resolveSharedMediaUrl(safeUrl).then((result) => {
      if (checkId !== checkIdRef.current) return;
      setResolved(result);
    });
  }, [safeUrl, cachedUrl]);

  return cachedUrl ?? resolved;
};

/**
 * Like useCachedMediaUrl, but returns undefined until cache resolution completes.
 * Use for media that must not swap from a remote URL to its cached URL after
 * rendering starts. Uses the Redux cache map for instant resolution when available.
 */
export const useResolvedCachedMediaUrl = (
  url: string | undefined,
): string | undefined => {
  const safeUrl = isLocalMediaReferenceUrl(url) ? undefined : url;
  const cachedUrl = useSelector((state: RootState) =>
    safeUrl ? state.mediaCacheMap?.map?.[safeUrl] : undefined,
  );
  const [state, setState] = useState<{
    resolved: string | undefined;
    forUrl: string | undefined;
  }>(() => ({
    resolved: safeUrl ? peekResolvedMediaUrl(safeUrl) : undefined,
    forUrl: safeUrl,
  }));
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
    if (cachedUrl) {
      setState({ resolved: cachedUrl, forUrl: safeUrl });
      return;
    }

    const resolvedUrl = getResolvedMediaUrl(safeUrl);
    if (resolvedUrl !== undefined) {
      setState({ resolved: resolvedUrl, forUrl: safeUrl });
      return;
    }

    const checkId = ++checkIdRef.current;
    setState({ resolved: undefined, forUrl: safeUrl });

    void resolveSharedMediaUrl(safeUrl).then((result) => {
      if (checkId !== checkIdRef.current) return;
      setState({ resolved: result, forUrl: safeUrl });
    });
  }, [safeUrl, cachedUrl]);

  if (cachedUrl) return cachedUrl;
  if (state.forUrl !== safeUrl) return undefined;
  return state.resolved;
};

export const useCachedVideoUrl = useResolvedCachedMediaUrl;
