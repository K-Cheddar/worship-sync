import type { ServiceTime } from "../../types";
import { getClosestUpcomingService } from "../../utils/serviceTimes";
import { serverDate } from "../../utils/serverTime";
import { calendarMonthRange, type PlainDateRange } from "./rangeSelection";
import { calendarDateInTimeZone } from "../../utils/teamScheduleOccurrences";
import { parsePlainDate } from "../../utils/plainDate";

/** Full calendar month containing the next configured service occurrence. */
export const getUpcomingServiceRange = (
  services: ServiceTime[],
  now = serverDate(),
  timeZone = "UTC",
): PlainDateRange => {
  const nextService = getClosestUpcomingService(services, now, timeZone);
  const reference = nextService?.nextAt || now;
  const localDate = parsePlainDate(calendarDateInTimeZone(reference, timeZone));
  return calendarMonthRange(localDate || reference);
};
