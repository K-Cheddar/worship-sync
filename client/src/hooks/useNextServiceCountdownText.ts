import { useEffect, useMemo, useState } from "react";
import { formatTime } from "../components/DisplayWindow/TimerDisplay";
import { serverNow } from "../utils/serverTime";

const listeners = new Set<() => void>();
/** Browser timer handles are numbers; Node’s timer handles are objects. */
let tickerIntervalId: number | null = null;
export const COUNTDOWN_TICK_MS = 250;

/**
 * Whole seconds remaining until `targetIso`, from an absolute clock.
 * Never decrements a local counter — always derived from target − now.
 */
export const getRemainingSecondsFromTarget = (
  targetIso: string,
  nowMs: number,
): number =>
  Math.max(0, Math.floor((new Date(targetIso).getTime() - nowMs) / 1000));

const clearCountdownScheduler = () => {
  if (tickerIntervalId !== null) {
    window.clearInterval(tickerIntervalId);
    tickerIntervalId = null;
  }
};

const scheduleCountdownTick = () => {
  clearCountdownScheduler();
  if (listeners.size === 0) return;

  tickerIntervalId = window.setInterval(() => {
    // Consumers recompute from absolute time — late callbacks self-correct
    // and never accumulate drift from a local counter.
    listeners.forEach((notify) => notify());
  }, COUNTDOWN_TICK_MS);
};

/** Shared cadence ticker for next-service countdown UIs. */
export const subscribeCountdownTicker = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    scheduleCountdownTick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearCountdownScheduler();
    }
  };
};

/** Test helper: drop subscribers and cancel any pending timeout. */
export const resetCountdownTickerForTests = () => {
  listeners.clear();
  clearCountdownScheduler();
};

const getRemainingSeconds = (targetIso: string) =>
  getRemainingSecondsFromTarget(targetIso, serverNow());

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
      const nextRemainingSeconds = getRemainingSeconds(targetIso);
      setRemainingSeconds((currentRemainingSeconds) =>
        currentRemainingSeconds === nextRemainingSeconds
          ? currentRemainingSeconds
          : nextRemainingSeconds,
      );
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
