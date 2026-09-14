import { useEffect, useMemo, useState } from "react";
import { formatTime } from "../components/DisplayWindow/TimerDisplay";
import { serverNow } from "../utils/serverTime";

const listeners = new Set<() => void>();
/** Browser `window.setTimeout` returns a number; Node’s does not. */
let tickerTimeoutId: number | null = null;

/**
 * Whole seconds remaining until `targetIso`, from an absolute clock.
 * Never decrements a local counter — always derived from target − now.
 */
export const getRemainingSecondsFromTarget = (
  targetIso: string,
  nowMs: number,
): number =>
  Math.max(0, Math.floor((new Date(targetIso).getTime() - nowMs) / 1000));

/**
 * Delay until the next whole-second boundary on the given clock.
 * Aligns wakeups to real-time second flips instead of a free-running interval.
 */
export const getNextCountdownDelayMs = (nowMs: number): number => {
  const msIntoSecond = ((nowMs % 1000) + 1000) % 1000;
  return msIntoSecond === 0 ? 1000 : 1000 - msIntoSecond;
};

const clearCountdownScheduler = () => {
  if (tickerTimeoutId !== null) {
    window.clearTimeout(tickerTimeoutId);
    tickerTimeoutId = null;
  }
};

const scheduleCountdownTick = () => {
  clearCountdownScheduler();
  if (listeners.size === 0) return;

  const delayMs = getNextCountdownDelayMs(serverNow());
  tickerTimeoutId = window.setTimeout(() => {
    tickerTimeoutId = null;
    // Recompute subscribers from absolute time — late/throttled callbacks
    // self-correct and never accumulate drift from a local counter.
    listeners.forEach((notify) => notify());
    if (listeners.size > 0) {
      scheduleCountdownTick();
    }
  }, delayMs);
};

/** Shared second-boundary ticker for next-service countdown UIs. */
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
