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
  hostId: string,
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
    (timer): timer is TimerInfo => timer !== undefined,
  );
};

export const calculateEndTime = (
  timerInfo: TimerInfo,
  isStarting: boolean,
  isResuming: boolean,
  existingTimer?: TimerInfo,
): string | undefined => {
  if (isStarting) {
    if (timerInfo.timerType === "timer" && timerInfo.duration) {
      // For regular timers, set endTime based on duration
      return new Date(Date.now() + timerInfo.duration * 1000).toISOString();
    } else if (timerInfo.timerType === "countdown") {
      // For countdown timers, set endTime based on target time
      const [hours, minutes] = (timerInfo.countdownTime || "00:00")
        .split(":")
        .map(Number);
      const targetTime = new Date();
      targetTime.setHours(hours, minutes, 0, 0);
      if (targetTime < new Date()) {
        targetTime.setDate(targetTime.getDate() + 1);
      }
      return targetTime.toISOString();
    }
  } else if (isResuming && existingTimer?.remainingTime) {
    // For resuming timers, set endTime based on remaining time
    return new Date(
      Date.now() + existingTimer.remainingTime * 1000,
    ).toISOString();
  } else if (existingTimer?.endTime && existingTimer.status === "running") {
    // Preserve existing endTime for running timers
    return existingTimer.endTime;
  }
  return timerInfo.endTime;
};

export const getTimeDifference = (timeString: string) => {
  const now = new Date();
  const [hours, minutes] = timeString.split(":").map(Number);

  // Create a new Date object for today with the specified time
  const targetTime = new Date(now);
  targetTime.setHours(hours, minutes, 0, 0);

  // If the target time has already passed today, set it to tomorrow
  if (targetTime < now) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  const secondsDiff = Math.floor((targetTime.getTime() - now.getTime()) / 1000);
  return secondsDiff;
};

type CalculateRemainingTimeParams = {
  timerInfo: Partial<TimerInfo>;
  previousStatus?: "running" | "paused" | "stopped";
};

export const calculateRemainingTime = ({
  timerInfo,
  previousStatus,
}: CalculateRemainingTimeParams): number => {
  if (timerInfo.timerType === "timer") {
    const isStopping = timerInfo.status === "stopped";
    const isStartingFromStopped =
      timerInfo.status === "running" && previousStatus === "stopped";
    const isResumingFromPaused =
      timerInfo.status === "running" && previousStatus === "paused";

    // Reset timer to full duration when:
    // 1. Timer is explicitly stopped
    // 2. Timer is started from a stopped state
    if (isStopping || isStartingFromStopped) {
      return timerInfo.duration || 0;
    }

    // Keep current time when:
    // 1. Pausing the timer
    // 2. Resuming from paused state
    if (timerInfo.status === "paused" || isResumingFromPaused) {
      return timerInfo.remainingTime || 0;
    }

    // If timer is running and has an end time, calculate remaining time
    if (timerInfo.status === "running" && timerInfo.endTime) {
      const endTime = new Date(timerInfo.endTime);
      const now = new Date();
      const remainingSeconds = Math.floor(
        (endTime.getTime() - now.getTime()) / 1000,
      );
      return Math.max(0, remainingSeconds); // Ensure we don't return negative time
    }

    return timerInfo.remainingTime || 0;
  } else {
    // For countdown timers
    const isResumingFromPaused =
      timerInfo.status === "running" && previousStatus === "paused";

    // If resuming from paused state, use the stored remaining time
    if (isResumingFromPaused && timerInfo.remainingTime !== undefined) {
      return timerInfo.remainingTime;
    }

    // Otherwise, calculate new time difference to target time
    return getTimeDifference(timerInfo.countdownTime || "00:00");
  }
};
