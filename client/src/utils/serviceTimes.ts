import {
  MonthWeekOrdinal,
  MultiWeeklyDay,
  RecurrenceType,
  ServiceTime,
  Weekday,
} from "../types";
import { serverDate } from "./serverTime";

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
): { service: ServiceTime; nextAt: Date } | null => {
  if (graceMs <= 0) return null;

  let bestRecent: { service: ServiceTime; nextAt: Date } | null = null;
  for (const service of services) {
    const target = getMostRecentTargetTime(service, now);
    if (!target) continue;
    const ageMs = now.getTime() - target.getTime();
    if (ageMs < 0 || ageMs > graceMs) continue;
    if (!bestRecent || target > bestRecent.nextAt) {
      bestRecent = { service, nextAt: target };
    }
  }
  return bestRecent;
};

function parseTimeToDate(base: Date, hhmm: string): Date | null {
  const [hh, mm] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const d = new Date(base);
  d.setHours(hh, mm, 0, 0);
  return d;
}

function getNextWeekly(
  now: Date,
  dayOfWeek: Weekday,
  time: string,
): Date | null {
  const currentDow = now.getDay();
  const daysUntil = (dayOfWeek - currentDow + 7) % 7;
  const candidate = new Date(now);
  candidate.setDate(now.getDate() + daysUntil);
  const atTime = parseTimeToDate(candidate, time);
  if (!atTime) return null;
  // If today and time already passed, move to next week
  if (daysUntil === 0 && atTime <= now) {
    atTime.setDate(atTime.getDate() + 7);
  }
  return atTime;
}

function getNthWeekdayOfMonth(
  year: number,
  monthIndex0: number,
  ordinal: MonthWeekOrdinal,
  weekday: Weekday,
): Date | null {
  // Find first occurrence of weekday in the month
  const firstOfMonth = new Date(year, monthIndex0, 1);
  const firstDow = firstOfMonth.getDay();
  const delta = (weekday - firstDow + 7) % 7;
  const firstWeekday = new Date(year, monthIndex0, 1 + delta);

  // ordinal 5 means last occurrence (if exists)
  if (ordinal === 5) {
    const nextMonth = new Date(year, monthIndex0 + 1, 1);
    const lastDayPrevMonth = new Date(nextMonth.getTime() - 1);
    // Walk back to the desired weekday
    const diff = (lastDayPrevMonth.getDay() - weekday + 7) % 7;
    const lastWeekday = new Date(
      lastDayPrevMonth.getFullYear(),
      lastDayPrevMonth.getMonth(),
      lastDayPrevMonth.getDate() - diff,
    );
    return lastWeekday;
  }

  const date = new Date(firstWeekday);
  date.setDate(firstWeekday.getDate() + (ordinal - 1) * 7);
  // Ensure still in the same month
  if (date.getMonth() !== monthIndex0) return null;
  return date;
}

function getNextMonthly(
  now: Date,
  ordinal: MonthWeekOrdinal,
  weekday: Weekday,
  time: string,
): Date | null {
  const tryMonth = (y: number, m: number): Date | null => {
    const day = getNthWeekdayOfMonth(y, m, ordinal, weekday);
    if (!day) return null;
    const atTime = parseTimeToDate(day, time);
    return atTime;
  };

  const candidateThis = tryMonth(now.getFullYear(), now.getMonth());
  if (candidateThis && candidateThis > now) return candidateThis;

  return tryMonth(now.getFullYear(), now.getMonth() + 1);
}

// Parse a date-only string ("YYYY-MM-DD") as local end-of-day.
// new Date("YYYY-MM-DD") is UTC midnight and breaks in non-UTC timezones.
const parseEndOfDay = (dateStr: string): Date | null => {
  const parts = dateStr.split("-");
  if (parts.length < 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return new Date(y, m, d, 23, 59, 59, 999);
};

const getNextMultiWeekly = (
  now: Date,
  daysOfWeek: MultiWeeklyDay[],
  endDateISO?: string,
): Date | null => {
  if (daysOfWeek.length === 0) return null;
  const endDate = endDateISO ? parseEndOfDay(endDateISO) : null;

  let best: Date | null = null;
  const currentDow = now.getDay();

  for (const { day, time } of daysOfWeek) {
    const daysUntil = (day - currentDow + 7) % 7;
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + daysUntil);
    const atTime = parseTimeToDate(candidate, time);
    if (!atTime) continue;
    if (daysUntil === 0 && atTime <= now) {
      atTime.setDate(atTime.getDate() + 7);
    }
    if (endDate && atTime > endDate) continue;
    if (!best || atTime < best) best = atTime;
  }
  return best;
};

const getPreviousMultiWeekly = (
  now: Date,
  daysOfWeek: MultiWeeklyDay[],
): Date | null => {
  if (daysOfWeek.length === 0) return null;
  const currentDow = now.getDay();
  let best: Date | null = null;

  for (const { day, time } of daysOfWeek) {
    const daysSince = (currentDow - day + 7) % 7;
    const candidate = new Date(now);
    candidate.setDate(now.getDate() - daysSince);
    const atTime = parseTimeToDate(candidate, time);
    if (!atTime) continue;
    if (daysSince === 0 && atTime > now) {
      atTime.setDate(atTime.getDate() - 7);
    }
    if (!best || atTime > best) best = atTime;
  }
  return best;
};

const getPreviousWeekly = (
  now: Date,
  dayOfWeek: Weekday,
  time: string,
): Date | null => {
  const currentDow = now.getDay();
  const daysSince = (currentDow - dayOfWeek + 7) % 7;
  const candidate = new Date(now);
  candidate.setDate(now.getDate() - daysSince);
  const atTime = parseTimeToDate(candidate, time);
  if (!atTime) return null;
  if (daysSince === 0 && atTime > now) {
    atTime.setDate(atTime.getDate() - 7);
  }
  return atTime;
};

const getPreviousMonthly = (
  now: Date,
  ordinal: MonthWeekOrdinal,
  weekday: Weekday,
  time: string,
): Date | null => {
  const tryMonth = (y: number, m: number): Date | null => {
    const day = getNthWeekdayOfMonth(y, m, ordinal, weekday);
    if (!day) return null;
    return parseTimeToDate(day, time);
  };

  const candidateThis = tryMonth(now.getFullYear(), now.getMonth());
  if (candidateThis && candidateThis <= now) return candidateThis;

  return tryMonth(now.getFullYear(), now.getMonth() - 1);
};

export function getNextOccurrenceForService(
  service: ServiceTime,
  now = serverDate(),
): Date | null {
  if (service.reccurence === "one_time") {
    if (!service.dateTimeISO) return null;
    const dt = new Date(service.dateTimeISO);
    return dt > now ? dt : null;
  }
  if (service.reccurence === "weekly") {
    if (service.dayOfWeek == null || !service.time) return null;
    return getNextWeekly(now, service.dayOfWeek, service.time);
  }
  if (service.reccurence === "monthly") {
    if (service.ordinal == null || service.weekday == null || !service.time)
      return null;
    return getNextMonthly(now, service.ordinal, service.weekday, service.time);
  }
  if (service.reccurence === "multi_weekly") {
    if (!service.daysOfWeek?.length) return null;
    return getNextMultiWeekly(now, service.daysOfWeek, service.endDateISO);
  }
  return null;
}

export function getClosestUpcomingService(
  services: ServiceTime[],
  now = serverDate(),
): { service: ServiceTime; nextAt: Date } | null {
  let best: { service: ServiceTime; nextAt: Date } | null = null;
  for (const s of services) {
    const nextAt = getEffectiveTargetTime(s, now);
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
): Date | null {
  // If there's an override, use it (if it's in the future)
  if (service.overrideDateTimeISO) {
    const overrideTime = new Date(service.overrideDateTimeISO);
    if (overrideTime > now) {
      return overrideTime;
    }
  }

  // Otherwise, use the calculated next occurrence
  return getNextOccurrenceForService(service, now);
}

export function getMostRecentTargetTime(
  service: ServiceTime,
  now = serverDate(),
): Date | null {
  if (service.overrideDateTimeISO) {
    const overrideTime = new Date(service.overrideDateTimeISO);
    if (overrideTime <= now) {
      return overrideTime;
    }
  }

  if (service.reccurence === "one_time") {
    if (!service.dateTimeISO) return null;
    const dt = new Date(service.dateTimeISO);
    return dt <= now ? dt : null;
  }
  if (service.reccurence === "weekly") {
    if (service.dayOfWeek == null || !service.time) return null;
    return getPreviousWeekly(now, service.dayOfWeek, service.time);
  }
  if (service.reccurence === "monthly") {
    if (service.ordinal == null || service.weekday == null || !service.time)
      return null;
    return getPreviousMonthly(
      now,
      service.ordinal,
      service.weekday,
      service.time,
    );
  }
  if (service.reccurence === "multi_weekly") {
    if (!service.daysOfWeek?.length) return null;
    return getPreviousMultiWeekly(now, service.daysOfWeek);
  }
  return null;
}

export function getDisplayedUpcomingService(
  services: ServiceTime[],
  now = serverDate(),
  graceMs = 0,
  options: DisplayedUpcomingServiceOptions = {},
): { service: ServiceTime; nextAt: Date } | null {
  const bestRecent = getMostRecentServiceWithinGrace(services, now, graceMs);
  const futureUpcoming = getClosestUpcomingService(services, now);

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
): number | null {
  const bestRecent = getMostRecentServiceWithinGrace(services, now, graceMs);
  const futureUpcoming = getClosestUpcomingService(services, now);
  const displayedService = getDisplayedUpcomingService(
    services,
    now,
    graceMs,
    options,
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
