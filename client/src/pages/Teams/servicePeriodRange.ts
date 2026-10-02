import type { ServiceTime } from "../../types";
import { getClosestUpcomingService } from "../../utils/serviceTimes";
import { serverDate } from "../../utils/serverTime";
import { calendarMonthRange, type PlainDateRange } from "./rangeSelection";

/** Full calendar month containing the next configured service occurrence. */
export const getUpcomingServiceRange = (
  services: ServiceTime[],
  now = serverDate(),
): PlainDateRange => {
  const nextService = getClosestUpcomingService(services, now);
  return calendarMonthRange(nextService?.nextAt || now);
};
