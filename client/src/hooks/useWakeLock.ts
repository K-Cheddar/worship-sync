import { useEffect, useRef } from "react";

/**
 * Holds a screen wake lock for as long as the calling surface is mounted.
 *
 * The platform releases the sentinel whenever the document is hidden — the tab
 * is backgrounded, the phone is locked, or the user switches apps — and it does
 * **not** come back on its own. A display surface that only requests once at
 * mount silently stops holding the screen awake after the first interruption,
 * which on a phone or tablet acting as a monitor means the screen sleeps mid-service.
 * Re-requesting on `visibilitychange` is what makes the lock durable.
 *
 * Requests are skipped while the document is hidden because the API rejects
 * them, and are serialized through `pendingRef` so rapid visibility flapping
 * cannot leave two sentinels held.
 */
export const useWakeLock = (enabled = true) => {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const pendingRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.wakeLock?.request) {
      return;
    }

    let cancelled = false;

    const attempt = async () => {
      // Re-checked here, not at queue time: a queued attempt must judge the
      // state it actually runs in.
      if (cancelled) return;
      if (sentinelRef.current && !sentinelRef.current.released) return;
      if (document.visibilityState !== "visible") return;

      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch (err) {
        // Denied (hidden document, low battery, unsupported). A queued attempt
        // or a later visibilitychange will retry.
        console.error("Error acquiring wake lock:", err);
      }
    };

    /**
     * Serializes attempts by chaining rather than dropping them.
     *
     * Dropping a request while one is in flight loses a real re-acquire: if the
     * document hides and shows again mid-request, that request then fails
     * (the platform rejects while hidden) and nothing would retry until the
     * next visibility change — leaving a projector or monitor free to sleep.
     * Queueing keeps the wake-up, and the queued attempt bails harmlessly if
     * the earlier one already took a lock.
     */
    const acquire = (): Promise<void> => {
      const next = (pendingRef.current ?? Promise.resolve()).then(attempt);
      pendingRef.current = next;
      void next.finally(() => {
        if (pendingRef.current === next) {
          pendingRef.current = null;
        }
      });
      return next;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel && !sentinel.released) {
        void sentinel.release().catch(() => {});
      }
    };
  }, [enabled]);
};
