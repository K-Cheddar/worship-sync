import { useEffect, useMemo, useState } from "react";
import { formatTime } from "../components/DisplayWindow/TimerDisplay";
import { serverNow } from "../utils/serverTime";

const COUNTDOWN_TICK_MS = 100;

const listeners = new Set<() => void>();
/** Browser `window.setInterval` returns a number; Node’s `setInterval` does not. */
let tickerIntervalId: number | null = null;

const subscribeCountdownTicker = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (tickerIntervalId === null) {
    tickerIntervalId = window.setInterval(() => {
      listeners.forEach((notify) => notify());
    }, COUNTDOWN_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && tickerIntervalId !== null) {
      window.clearInterval(tickerIntervalId);
      tickerIntervalId = null;
    }
  };
};

const getRemainingSeconds = (targetIso: string) =>
  Math.max(0, Math.floor((new Date(targetIso).getTime() - serverNow()) / 1000));

/**
 * Derived local countdown text for next-service surfaces.
 * This is intentionally not stored in the global timers slice because it is
 * only used by service-time UIs and is not a real timer item.
 */
export const useNextServiceCountdownText = (
  targetIso: string | null,
): string | null => {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!targetIso) {
      setRemainingSeconds(null);
      return;
    }

    const update = () => {
      setRemainingSeconds(getRemainingSeconds(targetIso));
    };

    update();
    return subscribeCountdownTicker(update);
  }, [targetIso]);

  return useMemo(() => {
    if (remainingSeconds == null) return null;
    return formatTime(remainingSeconds, false) as string;
  }, [remainingSeconds]);
};

export default useNextServiceCountdownText;
