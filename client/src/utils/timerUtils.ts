import { TimerInfo } from "../types";

/**
 * Merges local and remote timers, prioritizing timers from the specified host
 * @param currentTimers - Array of timers from Firebase
 * @param ownTimers - Array of timers owned by the current host
 * @param hostId - The ID of the current host
 * @returns Merged array of timers
 */
export const mergeTimers = (
  currentTimers: TimerInfo[] = [],
  ownTimers: TimerInfo[] = [],
  hostId: string
): TimerInfo[] => {
  const timerMap = new Map();

  // First add other timers to the map
  currentTimers.forEach((timer: TimerInfo) => {
    if (timer.hostId !== hostId) {
      timerMap.set(timer.id, timer);
    }
  });

  // Then add own timers, which will override any existing timers with the same ID
  ownTimers.forEach((timer: TimerInfo) => {
    timerMap.set(timer.id, timer);
  });

  // Convert map back to array and filter out any undefined values
  return Array.from(timerMap.values()).filter(
    (timer): timer is TimerInfo => timer !== undefined
  );
};
