import { useEffect, useRef } from "react";

const MIN_AWAY_MS = 10_000;
const RESUME_DEDUPE_MS = 1_000;

type PullFromRemote = () => void | Promise<unknown>;

/**
 * Calls pullFromRemote when coming back online after being offline,
 * or when the tab becomes visible again after being hidden,
 * only if the user was away for at least 10 seconds. Resume signals are
 * coalesced while a pull is running and for a short period afterward.
 */
export function useSyncOnReconnect(pullFromRemote: PullFromRemote | undefined) {
  const offlineSinceRef = useRef<number | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);
  const pullInFlightRef = useRef<Promise<unknown> | null>(null);
  const lastPullAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pullFromRemote) return;

    const triggerPull = () => {
      const now = Date.now();
      if (
        pullInFlightRef.current ||
        (lastPullAtRef.current !== null &&
          now - lastPullAtRef.current < RESUME_DEDUPE_MS)
      ) {
        return;
      }
      lastPullAtRef.current = now;
      let result: void | Promise<unknown>;
      try {
        result = pullFromRemote();
      } catch {
        return;
      }
      if (!result || typeof result.then !== "function") return;

      const request = Promise.resolve(result).catch(() => undefined);
      pullInFlightRef.current = request;
      void request.finally(() => {
        if (pullInFlightRef.current === request) {
          pullInFlightRef.current = null;
        }
      });
    };

    const triggerAfterAway = (since: number | null) => {
      if (since === null) return;
      hiddenSinceRef.current = null;
      if (Date.now() - since >= MIN_AWAY_MS) triggerPull();
    };

    const handleOnline = () => {
      const since = offlineSinceRef.current;
      offlineSinceRef.current = null;
      if (since !== null && Date.now() - since >= MIN_AWAY_MS) {
        triggerPull();
      }
    };

    const handleOffline = () => {
      offlineSinceRef.current = Date.now();
    };

    const markHidden = () => {
      if (hiddenSinceRef.current === null) hiddenSinceRef.current = Date.now();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markHidden();
      } else if (document.visibilityState === "visible") {
        triggerAfterAway(hiddenSinceRef.current);
      }
    };

    const handlePageHide = () => markHidden();
    const handlePageShow = () => triggerAfterAway(hiddenSinceRef.current);
    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        triggerAfterAway(hiddenSinceRef.current);
      }
    };

    if (document.visibilityState === "hidden") markHidden();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pullFromRemote]);
}
