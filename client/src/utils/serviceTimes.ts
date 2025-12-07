import { MonthWeekOrdinal, ServiceTime, Weekday } from "../types";

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
  time: string
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
  weekday: Weekday
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
      lastDayPrevMonth.getDate() - diff
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
  time: string
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

export function getNextOccurrenceForService(
  service: ServiceTime,
  now = new Date()
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
  return null;
}

export function getClosestUpcomingService(
  services: ServiceTime[],
  now = new Date()
): { service: ServiceTime; nextAt: Date } | null {
  let best: { service: ServiceTime; nextAt: Date } | null = null;
  for (const s of services) {
    const nextAt = getNextOccurrenceForService(s, now);
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
 * @param now Optional current time (defaults to new Date())
 * @returns The target date, or null if none exists
 */
export function getEffectiveTargetTime(
  service: ServiceTime,
  now = new Date()
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
