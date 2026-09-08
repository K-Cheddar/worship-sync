import { useEffect, useState } from "react";
import { getYouTubeStatus } from "./api";

/** Short burst only when something suggests Firebase may be stale. */
const YOUTUBE_STATUS_RECONCILE_DELAYS_MS = [0, 10_000, 30_000] as const;

export type YouTubeConnectionStatus = {
  connected: boolean;
  accountLabel: string;
};

export type UseYouTubeConnectionStatusOptions = {
  /**
   * When Firebase says disconnected, allow a short API reconcile burst.
   * Pass true only with evidence of a false negative (live Restream, etc.).
   */
  reconcile?: boolean;
};

/**
 * Prefer the Firebase integrations mirror when it already says connected.
 * If Firebase says disconnected but `reconcile` is true, briefly check the
 * token API, then stop — do not poll forever for churches with no YouTube link.
 */
export const useYouTubeConnectionStatus = (
  churchId: string,
  firebaseConnected: boolean,
  firebaseAccountLabel = "",
  options: UseYouTubeConnectionStatusOptions = {},
): YouTubeConnectionStatus => {
  const reconcile = Boolean(options.reconcile);
  const [apiConnected, setApiConnected] = useState(false);
  const [apiAccountLabel, setApiAccountLabel] = useState("");

  useEffect(() => {
    if (!churchId || firebaseConnected) {
      setApiConnected(false);
      setApiAccountLabel("");
      return;
    }
    if (!reconcile) {
      // Keep any prior API hit; do not poll without evidence of a false negative.
      return;
    }

    let cancelled = false;
    const timeoutIds: number[] = [];

    const reconcileOnce = async () => {
      try {
        const status = await getYouTubeStatus(churchId);
        if (cancelled) return;
        setApiConnected(Boolean(status.connected));
        setApiAccountLabel(String(status.accountLabel || "").trim());
      } catch {
        // Keep the last API result; Firebase already says disconnected.
      }
    };

    for (const delayMs of YOUTUBE_STATUS_RECONCILE_DELAYS_MS) {
      timeoutIds.push(
        window.setTimeout(() => {
          void reconcileOnce();
        }, delayMs),
      );
    }

    return () => {
      cancelled = true;
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [churchId, firebaseConnected, reconcile]);

  if (firebaseConnected) {
    return {
      connected: true,
      accountLabel: firebaseAccountLabel,
    };
  }

  return {
    connected: apiConnected,
    accountLabel: apiAccountLabel || firebaseAccountLabel,
  };
};
