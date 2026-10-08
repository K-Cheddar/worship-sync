import {
  RecurrenceType,
  ServiceTime,
} from "../types";
import { formatPlainDate, parsePlainDate } from "./plainDate";
import { serverDate } from "./serverTime";
import type { TeamService } from "../api/authTypes";
import {
  calendarDateInTimeZone,
  generateScheduleOccurrences,
} from "./teamScheduleOccurrences";

type ServiceScheduleSortShape = Pick<
  ServiceTime,
  | "name"
  | "reccurence"
  | "dayOfWeek"
  | "time"
  | "daysOfWeek"
  | "weekday"
  | "ordinal"
  | "dateTimeISO"
>;

const RECURRENCE_SORT_RANK: Record<RecurrenceType, number> = {
  weekly: 0,
  multi_weekly: 1,
  monthly: 2,
  one_time: 3,
};

const parseScheduleTimeToMinutes = (time?: string): number => {
  if (!time) return 0;
  const [hh, mm] = time.split(":").map((part) => Number(part));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return hh * 60 + mm;
};

/** Stable week-order key for admin lists: weekday, then time, then name. */
export const getServiceScheduleSortKey = (
  service: ServiceScheduleSortShape,
): [number, number, number, string] => {
  const recurrence = service.reccurence || "weekly";
  const rank = RECURRENCE_SORT_RANK[recurrence] ?? 99;

  if (recurrence === "one_time") {
    const timestamp = service.dateTimeISO
      ? new Date(service.dateTimeISO).getTime()
      : Number.MAX_SAFE_INTEGER;
    return [rank, timestamp, 0, service.name || ""];
  }

  if (recurrence === "weekly") {
    return [
      rank,
      service.dayOfWeek ?? 7,
      parseScheduleTimeToMinutes(service.time),
      service.name || "",
    ];
  }

  if (recurrence === "multi_weekly") {
    const days = service.daysOfWeek || [];
    if (days.length === 0) {
      return [rank, 7, 0, service.name || ""];
    }
    const earliest = [...days].sort(
      (a, b) =>
        a.day - b.day ||
        parseScheduleTimeToMinutes(a.time) - parseScheduleTimeToMinutes(b.time),
    )[0];
    return [
      rank,
      earliest.day,
      parseScheduleTimeToMinutes(earliest.time),
      service.name || "",
    ];
  }

  if (recurrence === "monthly") {
    const ordinal = service.ordinal ?? 99;
    return [
      rank,
      service.weekday ?? 7,
      ordinal * 1440 + parseScheduleTimeToMinutes(service.time),
      service.name || "",
    ];
  }

  return [99, 0, 0, service.name || ""];
};

export const compareServicesByScheduleOrder = (
  a: ServiceScheduleSortShape,
  b: ServiceScheduleSortShape,
): number => {
  const keyA = getServiceScheduleSortKey(a);
  const keyB = getServiceScheduleSortKey(b);
  for (let index = 0; index < keyA.length; index += 1) {
    const left = keyA[index];
    const right = keyB[index];
    if (left === right) continue;
    if (typeof left === "string" && typeof right === "string") {
      return left.localeCompare(right);
    }
    return Number(left) - Number(right);
  }
  return 0;
};

export const sortServicesByScheduleOrder = <T extends ServiceScheduleSortShape>(
  services: T[],
): T[] => [...services].sort(compareServicesByScheduleOrder);

export type DisplayedUpcomingServiceOptions = {
  /**
   * When true, keep the most recently elapsed service during the grace window
   * even if another future service exists. This preserves the "pending at zero"
   * stream-info behavior before switching to the next service.
   */
  keepRecentlyElapsedDuringGrace?: boolean;
};

const getMostRecentServiceWithinGrace = (
  services: ServiceTime[],
  now: Date,
  graceMs: number,
  timeZone: string,
): { service: ServiceTime; nextAt: Date } | null => {
  if (graceMs <= 0) return null;

  let bestRecent: { service: ServiceTime; nextAt: Date } | null = null;
  for (const service of services) {
    const target = getMostRecentTargetTime(service, now, timeZone);
    if (!target) continue;
    const ageMs = now.getTime() - target.getTime();
    if (ageMs < 0 || ageMs > graceMs) continue;
    if (!bestRecent || target > bestRecent.nextAt) {
      bestRecent = { service, nextAt: target };
    }
  }
  return bestRecent;
};

const shiftPlainDate = (value: string, days: number) => {
  const date = parsePlainDate(value);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return formatPlainDate(date);
};

const generateServiceOccurrencesAround = (
  service: ServiceTime,
  now: Date,
  timeZone: string,
  direction: "future" | "past",
) => {
  const today = calendarDateInTimeZone(now, timeZone);
  // Weekly recurrences must be found within seven days. Monthly fifth-weekday
  // recurrences can skip a month, so keep a year-sized bound for those. Anchor
  // the bounded search at configured limits so a service starting or ending
  // far from today remains discoverable without scanning an unbounded range.
  const searchDays =
    service.reccurence === "weekly" || service.reccurence === "multi_weekly"
      ? 7
      : 400;
  const anchor = direction === "future"
    ? [today, service.startDateISO || today].sort().at(-1) || today
    : [today, service.endDateISO || today].sort()[0];
  const windowStart = direction === "future" ? anchor : shiftPlainDate(anchor, -searchDays);
  const windowEnd = direction === "future" ? shiftPlainDate(anchor, searchDays) : anchor;
  const startDate = [windowStart, service.startDateISO || windowStart].sort().at(-1) || windowStart;
  const endDate = [windowEnd, service.endDateISO || windowEnd].sort()[0];
  if (!startDate || !endDate || startDate > endDate) return [];
  const teamService = {
    ...service,
    serviceId: service.id,
    churchId: "",
  } as TeamService;
  return generateScheduleOccurrences({
    services: [teamService],
    serviceIds: [service.id],
    startDate,
    endDate,
    timeZone,
  });
};

export function getNextOccurrenceForService(
  service: ServiceTime,
  now = serverDate(),
  timeZone = "UTC",
): Date | null {
  if (service.reccurence === "one_time") {
    if (!service.dateTimeISO) return null;
    const dt = new Date(service.dateTimeISO);
    return dt > now ? dt : null;
  }
  const occurrence = generateServiceOccurrencesAround(service, now, timeZone, "future")
    .filter((item) => Date.parse(item.startsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return occurrence ? new Date(occurrence.startsAt) : null;
}

export function getClosestUpcomingService(
  services: ServiceTime[],
  now = serverDate(),
  timeZone = "UTC",
): { service: ServiceTime; nextAt: Date } | null {
  let best: { service: ServiceTime; nextAt: Date } | null = null;
  for (const s of services) {
    const nextAt = getEffectiveTargetTime(s, now, timeZone);
    if (!nextAt) continue;
    if (!best || nextAt < best.nextAt) {
      best = { service: s, nextAt };
    }
  }
  return best;
}

/**
 * Gets the effective target time for a service, considering overrideDateTimeISO if set.
 * This is the time that should be used for the timer display.
 * @param service The service to get the target time for
 * @param now Optional current time (defaults to Firebase-aligned server time)
 * @returns The target date, or null if none exists
 */
export function getEffectiveTargetTime(
  service: ServiceTime,
  now = serverDate(),
  timeZone = "UTC",
): Date | null {
  // If there's an override, use it (if it's in the future)
  if (service.overrideDateTimeISO) {
    const overrideTime = new Date(service.overrideDateTimeISO);
    if (overrideTime > now) {
      return overrideTime;
    }
  }

  // Otherwise, use the calculated next occurrence
  return getNextOccurrenceForService(service, now, timeZone);
}

export function getMostRecentTargetTime(
  service: ServiceTime,
  now = serverDate(),
  timeZone = "UTC",
): Date | null {
  let recentOverride: Date | null = null;
  if (service.overrideDateTimeISO) {
    const overrideTime = new Date(service.overrideDateTimeISO);
    if (overrideTime <= now) {
      recentOverride = overrideTime;
    }
  }

  let recentScheduled: Date | null = null;
  if (service.reccurence === "one_time") {
    if (service.dateTimeISO) {
      const dt = new Date(service.dateTimeISO);
      recentScheduled = dt <= now ? dt : null;
    }
  } else if (service.reccurence) {
    const occurrence = generateServiceOccurrencesAround(service, now, timeZone, "past")
      .filter((item) => Date.parse(item.startsAt) <= now.getTime())
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
    recentScheduled = occurrence ? new Date(occurrence.startsAt) : null;
  }

  if (!recentOverride) return recentScheduled;
  if (!recentScheduled) return recentOverride;
  return recentOverride > recentScheduled ? recentOverride : recentScheduled;
}

export function getDisplayedUpcomingService(
  services: ServiceTime[],
  now = serverDate(),
  graceMs = 0,
  options: DisplayedUpcomingServiceOptions = {},
  timeZone = "UTC",
): { service: ServiceTime; nextAt: Date } | null {
  const bestRecent = getMostRecentServiceWithinGrace(services, now, graceMs, timeZone);
  const futureUpcoming = getClosestUpcomingService(services, now, timeZone);

  if (options.keepRecentlyElapsedDuringGrace && bestRecent) {
    if (!futureUpcoming) {
      return bestRecent;
    }

    const msUntilFuture = futureUpcoming.nextAt.getTime() - now.getTime();
    if (msUntilFuture > graceMs) {
      return bestRecent;
    }
  }

  if (futureUpcoming) return futureUpcoming;

  return bestRecent;
}

export function getUpcomingServiceRefreshDelay(
  services: ServiceTime[],
  now = serverDate(),
  graceMs = 0,
  options: DisplayedUpcomingServiceOptions = {},
  timeZone = "UTC",
): number | null {
  const bestRecent = getMostRecentServiceWithinGrace(services, now, graceMs, timeZone);
  const futureUpcoming = getClosestUpcomingService(services, now, timeZone);
  const displayedService = getDisplayedUpcomingService(
    services,
    now,
    graceMs,
    options,
    timeZone,
  );
  if (!displayedService) return null;

  const isShowingRecent =
    bestRecent?.service.id === displayedService.service.id &&
    bestRecent.nextAt.getTime() === displayedService.nextAt.getTime();

  if (isShowingRecent) {
    const recentAgeMs = now.getTime() - displayedService.nextAt.getTime();
    const remainingGraceMs = graceMs - recentAgeMs;
    let nextDelayMs = remainingGraceMs > 0 ? remainingGraceMs + 1 : 1;

    if (
      options.keepRecentlyElapsedDuringGrace &&
      futureUpcoming &&
      graceMs > 0
    ) {
      const msUntilFuture = futureUpcoming.nextAt.getTime() - now.getTime();
      const thresholdCrossDelayMs = msUntilFuture - graceMs;
      if (thresholdCrossDelayMs > 0) {
        nextDelayMs = Math.min(nextDelayMs, thresholdCrossDelayMs + 1);
      }
    }

    return nextDelayMs;
  }

  const msUntilTarget = displayedService.nextAt.getTime() - now.getTime();
  if (msUntilTarget > 0) {
    return msUntilTarget + 1;
  }

  if (graceMs <= 0) return null;
  const remainingGraceMs = graceMs - Math.abs(msUntilTarget);
  return remainingGraceMs > 0 ? remainingGraceMs + 1 : 1;
}
