import { TimerInfo } from "../types";
import { serverNow } from "./serverTime";

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
  const timerMap = new Map<string, TimerInfo>();

  // First add other timers to the map
  currentTimers.forEach((timer: TimerInfo) => {
    if (timer.hostId !== hostId) {
      timerMap.set(timer.id, timer);
    }
  });

  // Then add own timers, but do not overwrite a fresher timer from another host.
  ownTimers.forEach((timer: TimerInfo) => {
    const existingTimer = timerMap.get(timer.id);
    const existingTime = existingTimer?.time ?? -1;
    const ownTime = timer.time ?? -1;
    if (!existingTimer || ownTime >= existingTime) {
      timerMap.set(timer.id, timer);
    }
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
      return new Date(serverNow() + timerInfo.duration * 1000).toISOString();
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
      serverNow() + existingTimer.remainingTime * 1000,
    ).toISOString();
  } else if (existingTimer?.endTime && existingTimer.status === "running") {
    // Preserve existing endTime for running timers
    return existingTimer.endTime;
  }
  return timerInfo.endTime;
};

export const getTimeDifference = (timeString: string) => {
  const now = new Date(serverNow());
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

    // Pausing from a running state: capture the live remaining from endTime.
    // remainingTime is no longer ticked into Redux while running, so the stored
    // value is stale — derive the true remaining at the moment of pausing.
    if (timerInfo.status === "paused") {
      if (previousStatus === "running" && timerInfo.endTime) {
        const remainingSeconds = Math.floor(
          (new Date(timerInfo.endTime).getTime() - serverNow()) / 1000,
        );
        return Math.max(0, remainingSeconds);
      }
      // Already paused (or nothing to derive from): keep the stored value.
      return timerInfo.remainingTime || 0;
    }

    // Resuming from paused: keep the captured paused value. calculateEndTime
    // rebuilds endTime from it so the countdown continues from where it froze.
    if (isResumingFromPaused) {
      return timerInfo.remainingTime || 0;
    }

    // If timer is running and has an end time, calculate remaining time
    if (timerInfo.status === "running" && timerInfo.endTime) {
      const endTime = new Date(timerInfo.endTime);
      const now = new Date(serverNow());
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
