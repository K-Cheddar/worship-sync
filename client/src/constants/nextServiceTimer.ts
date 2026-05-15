/**
 * After the effective target time, wait this long before recomputing "closest upcoming"
 * (stream info + Service Times).
 */
export const NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS = 15 * 60 * 1000;

/**
 * Stable _id for the virtual "Upcoming Service" outline item.
 * This ID has no DB record; Item.tsx synthesizes it from serviceTimes state.
 */
export const SERVICE_TIME_COUNTDOWN_ID = "service-time-countdown";
