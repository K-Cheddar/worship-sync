import type { TeamScheduleOccurrence } from "../api/authTypes";
import { getOccurrenceDate } from "./teamScheduleOccurrences";

/**
 * A stable key identifying "this dated occurrence's service plan," deliberately
 * independent of `TeamScheduleOccurrence.occurrenceId` — that id is owned by the
 * Teams scheduling feature, scoped inside one `TeamSchedule` document's date
 * range, and can be regenerated/rekeyed by that feature on its own (combined
 * services split/merged, schedule re-synced, etc). A service plan needs to
 * outlive any particular schedule document, so it mints its own key using the
 * same `serviceId@date` / `group:groupId@date` convention at date granularity
 * (safe since one recurrence rule yields at most one instance per calendar date).
 */
export const getServicePlanKey = (occurrence: TeamScheduleOccurrence): string => {
  const date = getOccurrenceDate(occurrence);
  return occurrence.groupId
    ? `group:${occurrence.groupId}@${date}`
    : `${occurrence.serviceId}@${date}`;
};
