/** Redux / Firebase timer id for the next service countdown (stream overlay + info controller). */
export const NEXT_SERVICE_TIMER_ID = "next-service";

/** Scope the synthetic next-service timer to the local host so countdown UIs don't collide in shared timer sync. */
export const getNextServiceTimerId = (hostId?: string): string => {
  const trimmedHostId = hostId?.trim();
  return trimmedHostId
    ? `${NEXT_SERVICE_TIMER_ID}:${trimmedHostId}`
    : NEXT_SERVICE_TIMER_ID;
};

/**
 * After the effective target time, wait this long before recomputing "closest upcoming"
 * (stream info + ServiceTimes / info controller).
 */
export const NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS = 15 * 60 * 1000;
