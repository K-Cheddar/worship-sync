import { useEffect, useRef } from "react";

const MIN_AWAY_MS = 10_000;

/**
 * Calls pullFromRemote when coming back online after being offline,
 * or when the tab becomes visible again after being hidden,
 * only if the user was away for at least 10 seconds.
 */
export function useSyncOnReconnect(pullFromRemote: (() => void) | undefined) {
  const offlineSinceRef = useRef<number | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pullFromRemote) return;

    const handleOnline = () => {
      const since = offlineSinceRef.current;
      offlineSinceRef.current = null;
      if (since !== null && Date.now() - since >= MIN_AWAY_MS) {
        pullFromRemote();
      }
    };

    const handleOffline = () => {
      offlineSinceRef.current = Date.now();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
      } else if (document.visibilityState === "visible") {
        const since = hiddenSinceRef.current;
        hiddenSinceRef.current = null;
        if (since !== null && Date.now() - since >= MIN_AWAY_MS) {
          pullFromRemote();
        }
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pullFromRemote]);
}
