import { useEffect, useRef, useState } from "react";
import { serverNow } from "../utils/serverTime";
import type { TimerInfo } from "../types";
import { isTimerLive } from "../utils/timerUtils";

/** Display refresh cadence. Re-renders happen only when the whole-second value
 * actually changes, so this is cheap. */
const TICK_MS = 100;

// A single shared ticker drives every live timer display in a window. All
// subscribers are notified on the same tick, so they read the same clock and
// flip together (phase-aligned), and there is one interval total instead of one
// per timer widget.
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

const subscribeToTicker = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (intervalId === null) {
    intervalId = setInterval(() => {
      listeners.forEach((notify) => notify());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
};

// Absent is `null`, never 0. "No timer to show" and "zero seconds left" are
// different facts, and collapsing them is what painted a bare "0" on screen
// while sync was still in flight.
const computeRemaining = (timer?: TimerInfo): number | null => {
  if (!timer) return null;
  // Only derive from endTime while the timer is genuinely live. A stale
  // `running` timer whose end has long passed would otherwise clamp to 0.
  if (isTimerLive(timer) && timer.endTime) {
    return Math.max(
      0,
      Math.floor((new Date(timer.endTime).getTime() - serverNow()) / 1000),
    );
  }
  return timer.remainingTime ?? null;
};

/**
 * Live remaining-seconds for a timer.
 *
 * A running timer recomputes from `endTime` on the shared ticker; a non-running
 * timer just returns its stored value and doesn't subscribe. Keeping the
 * per-second countdown in component-local state (not Redux) means a tick
 * re-renders only the component showing it — not every `timers` subscriber
 * (which on the controller was the whole transmit panel and service list).
 */
export const useLiveRemainingSeconds = (timer?: TimerInfo): number | null => {
  const timerRef = useRef(timer);
  timerRef.current = timer;

  const [seconds, setSeconds] = useState(() => computeRemaining(timer));

  const isRunning = timer?.status === "running" && !!timer?.endTime;

  useEffect(() => {
    // Re-sync immediately, then follow the shared ticker while running.
    // setState bails out when the value is unchanged, so a re-render happens at
    // most once per second.
    const update = () => setSeconds(computeRemaining(timerRef.current));
    update();
    if (!isRunning) return;
    return subscribeToTicker(update);
  }, [
    isRunning,
    timer?.id,
    timer?.endTime,
    timer?.remainingTime,
    timer?.status,
  ]);

  // A non-running timer is a pure function of the timer, so read it during
  // render. `seconds` is seeded once at mount and only corrected by the effect
  // above, which runs after paint — so a component mounting before its timer
  // resolved painted one frame of the mount-time value (a bare 0) and then
  // snapped to the real one. Only the ticking case needs state.
  return isRunning ? seconds : computeRemaining(timer);
};
