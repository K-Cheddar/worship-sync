import type { TeamScheduleOccurrence, TeamService } from "../api/authTypes";
import type { MonthWeekOrdinal, Weekday } from "../types";
import { formatPlainDate, parsePlainDate } from "./plainDate";

const setDateTime = (date: Date, time = "10:00") => {
  const [hour = 0, minute = 0] = time.split(":").map((part) => Number(part));
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
};

const occurrenceIdFor = (serviceId: string, startsAt: string) =>
  `${serviceId}@${startsAt}`;

const toOccurrence = (
  service: TeamService,
  startsAt: Date,
): TeamScheduleOccurrence => {
  const iso = startsAt.toISOString();
  return {
    occurrenceId: occurrenceIdFor(service.serviceId, iso),
    serviceId: service.serviceId,
    name: service.name,
    startsAt: iso,
  };
};

const nthWeekdayOfMonth = (
  year: number,
  month: number,
  ordinal: MonthWeekOrdinal,
  weekday: Weekday,
) => {
  if (ordinal === 5) {
    const lastOfMonth = new Date(year, month + 1, 0);
    const offset = (lastOfMonth.getDay() - weekday + 7) % 7;
    lastOfMonth.setDate(lastOfMonth.getDate() - offset);
    return lastOfMonth;
  }
  const firstOfMonth = new Date(year, month, 1);
  const offset = (weekday - firstOfMonth.getDay() + 7) % 7;
  const result = new Date(year, month, 1 + offset + (ordinal - 1) * 7);
  return result.getMonth() === month ? result : null;
};

export const getDefaultScheduleRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: formatPlainDate(start),
    endDate: formatPlainDate(end),
  };
};

export const formatOccurrenceTiming = (occurrence: TeamScheduleOccurrence) =>
  new Date(occurrence.startsAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export type SharedOccurrenceTiming = {
  sharedWeekday: string | null;
  sharedTime: string | null;
};

const occurrenceWeekdayLabel = (startsAt: string) =>
  new Date(startsAt).toLocaleString(undefined, { weekday: "short" });

const occurrenceTimeLabel = (startsAt: string) =>
  new Date(startsAt).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const occurrenceWeekdayIndex = (startsAt: string) =>
  new Date(startsAt).getDay();

const occurrenceTimeKey = (startsAt: string) => {
  const date = new Date(startsAt);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
};

export const getSharedOccurrenceTiming = (
  occurrences: TeamScheduleOccurrence[],
): SharedOccurrenceTiming => {
  if (occurrences.length === 0) {
    return { sharedWeekday: null, sharedTime: null };
  }

  const weekdayIndexes = occurrences.map((occurrence) =>
    occurrenceWeekdayIndex(occurrence.startsAt),
  );
  const timeKeys = occurrences.map((occurrence) =>
    occurrenceTimeKey(occurrence.startsAt),
  );
  const sharedWeekday = weekdayIndexes.every(
    (weekday) => weekday === weekdayIndexes[0],
  )
    ? occurrenceWeekdayLabel(occurrences[0].startsAt)
    : null;
  const sharedTime = timeKeys.every((time) => time === timeKeys[0])
    ? occurrenceTimeLabel(occurrences[0].startsAt)
    : null;

  return { sharedWeekday, sharedTime };
};

export const formatOccurrenceRowLabel = (
  occurrence: TeamScheduleOccurrence,
  shared: SharedOccurrenceTiming,
) => {
  if (!shared.sharedWeekday && !shared.sharedTime) {
    return formatOccurrenceTiming(occurrence);
  }

  const date = new Date(occurrence.startsAt);
  const parts: string[] = [];

  if (!shared.sharedWeekday) {
    parts.push(occurrenceWeekdayLabel(occurrence.startsAt));
  }

  parts.push(
    date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  );

  if (!shared.sharedTime) {
    parts.push(occurrenceTimeLabel(occurrence.startsAt));
  }

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
  return `${parts[0]}, ${parts[1]}, ${parts[2]}`;
};

export const getOccurrenceDate = (occurrence: TeamScheduleOccurrence) =>
  occurrence.startsAt.slice(0, 10);

export const generateScheduleOccurrences = ({
  services,
  serviceIds,
  startDate,
  endDate,
}: {
  services: TeamService[];
  serviceIds: string[];
  startDate: string;
  endDate: string;
}) => {
  const start = parsePlainDate(startDate);
  const end = parsePlainDate(endDate);
  if (!start || !end || start > end) return [];

  const selectedServices = serviceIds
    .map((serviceId) =>
      services.find((service) => service.serviceId === serviceId),
    )
    .filter(Boolean) as TeamService[];
  const endTime = new Date(end);
  endTime.setHours(23, 59, 59, 999);
  const occurrences: TeamScheduleOccurrence[] = [];

  for (const service of selectedServices) {
    if (service.reccurence === "one_time") {
      const startsAt = service.dateTimeISO
        ? new Date(service.dateTimeISO)
        : null;
      if (startsAt && startsAt >= start && startsAt <= endTime) {
        occurrences.push(toOccurrence(service, startsAt));
      }
      continue;
    }

    if (service.reccurence === "weekly") {
      if (service.dayOfWeek == null || !service.time) continue;
      for (
        const cursor = new Date(start);
        cursor <= endTime;
        cursor.setDate(cursor.getDate() + 1)
      ) {
        if (cursor.getDay() === service.dayOfWeek) {
          occurrences.push(
            toOccurrence(service, setDateTime(cursor, service.time)),
          );
        }
      }
      continue;
    }

    if (service.reccurence === "multi_weekly") {
      const days = service.daysOfWeek || [];
      const serviceEnd = service.endDateISO
        ? parsePlainDate(service.endDateISO)
        : null;
      if (serviceEnd) serviceEnd.setHours(23, 59, 59, 999);
      for (
        const cursor = new Date(start);
        cursor <= endTime;
        cursor.setDate(cursor.getDate() + 1)
      ) {
        if (serviceEnd && cursor > serviceEnd) continue;
        const day = days.find((item) => item.day === cursor.getDay());
        if (day)
          occurrences.push(
            toOccurrence(service, setDateTime(cursor, day.time)),
          );
      }
      continue;
    }

    if (service.reccurence === "monthly") {
      if (service.ordinal == null || service.weekday == null || !service.time)
        continue;
      for (
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        cursor <= endTime;
        cursor.setMonth(cursor.getMonth() + 1)
      ) {
        const occurrenceDate = nthWeekdayOfMonth(
          cursor.getFullYear(),
          cursor.getMonth(),
          service.ordinal,
          service.weekday,
        );
        if (
          !occurrenceDate ||
          occurrenceDate < start ||
          occurrenceDate > endTime
        )
          continue;
        occurrences.push(
          toOccurrence(service, setDateTime(occurrenceDate, service.time)),
        );
      }
    }
  }

  return occurrences.sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      a.name.localeCompare(b.name),
  );
};

/** Services that would produce at least one occurrence in the given plain-date range. */
export const filterServicesWithOccurrencesInRange = ({
  services,
  startDate,
  endDate,
}: {
  services: TeamService[];
  startDate: string;
  endDate: string;
}) => {
  if (!startDate || !endDate) return [];
  return services.filter(
    (service) =>
      generateScheduleOccurrences({
        services,
        serviceIds: [service.serviceId],
        startDate,
        endDate,
      }).length > 0,
  );
};
