import type {
  PositionRequirement,
  TeamScheduleOccurrence,
  TeamService,
} from "../api/authTypes";
import type { MonthWeekOrdinal, Weekday } from "../types";
import { formatPlainDate, parsePlainDate } from "./plainDate";

const occurrenceIdFor = (serviceId: string, startsAt: string) =>
  `${serviceId}@${startsAt}`;

const toOccurrence = (
  service: TeamService,
  startsAt: Date,
  serviceDate: string,
): TeamScheduleOccurrence => {
  const iso = startsAt.toISOString();
  return {
    occurrenceId: occurrenceIdFor(service.serviceId, iso),
    serviceId: service.serviceId,
    name: service.name,
    startsAt: iso,
    serviceDate,
    ...(service.positionRequirements?.length
      ? {
          // Keep a schedule-time snapshot so every server-side slot check uses
          // the same requirements the grid was generated from. Copy each row
          // so later service edits cannot mutate an in-memory occurrence.
          positionRequirements: service.positionRequirements.map(
            (requirement) => ({
              ...requirement,
            }),
          ),
        }
      : {}),
  };
};

const MAX_TIME_ZONE_CACHE_ENTRIES = 12_000;
const wallClockFormatterCache = new Map<string, Intl.DateTimeFormat>();
const serviceDateOffsetsCache = new Map<string, number[]>();
const serviceDateTimeCache = new Map<string, number | null>();

const cacheValue = <T,>(cache: Map<string, T>, key: string, value: T): T => {
  if (cache.size >= MAX_TIME_ZONE_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, value);
  return value;
};

const wallClockFormatter = (timeZone: string) => {
  const cached = wallClockFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  wallClockFormatterCache.set(timeZone, formatter);
  return formatter;
};

const wallClockPartsAt = (instant: number, timeZone: string) => {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(instant));
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

const getServiceDateOffsets = (date: string, timeZone: string, naive: number) => {
  const key = `${timeZone}|${date}`;
  const cached = serviceDateOffsetsCache.get(key);
  if (cached) return cached;
  const offsets = new Set<number>();
  // Three samples cover the offset immediately around the date and both sides
  // of a DST transition. Recurring services on the same date share this work.
  for (const hours of [-36, 0, 36]) {
    const sample = naive + hours * 60 * 60 * 1000;
    const parts = wallClockPartsAt(sample, timeZone);
    const wallClock = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    offsets.add(Date.parse(`${wallClock}Z`) - sample);
  }
  return cacheValue(serviceDateOffsetsCache, key, [...offsets]);
};

/** Convert a service's local date and wall clock into an instant in its zone. */
export const serviceDateTimeInTimeZone = (
  date: string,
  time: string,
  timeZone: string,
): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return null;
  }
  const cacheKey = `${timeZone}|${date}|${time}`;
  const cached = serviceDateTimeCache.get(cacheKey);
  if (cached !== undefined) return cached === null ? null : new Date(cached);
  const requested = `${date}T${time}:00`;
  const naive = Date.parse(`${requested}Z`);
  try {
    const offsets = getServiceDateOffsets(date, timeZone, naive);
    const candidates = offsets.map((offset) => naive - offset);
    const exact = candidates
      .filter((instant) => {
        const parts = wallClockPartsAt(instant, timeZone);
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` === requested;
      })
      .sort((left, right) => left - right);
    if (exact.length) {
      cacheValue(serviceDateTimeCache, cacheKey, exact[0]);
      return new Date(exact[0]);
    }

    // Match the existing local Date behavior through a spring-forward gap by
    // moving the wall clock forward to the first valid time on the same date.
    const forward = candidates
      .map((instant) => {
        const parts = wallClockPartsAt(instant, timeZone);
        return {
          instant,
          wallClock: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`,
        };
      })
      .filter(({ wallClock }) => wallClock.slice(0, 10) === date && wallClock > requested)
      .sort((left, right) => left.wallClock.localeCompare(right.wallClock) || left.instant - right.instant)[0];
    cacheValue(serviceDateTimeCache, cacheKey, forward?.instant ?? null);
    return forward ? new Date(forward.instant) : null;
  } catch {
    cacheValue(serviceDateTimeCache, cacheKey, null);
    return null;
  }
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

export const getDefaultScheduleRange = (timeZone = "UTC") => {
  const now =
    parsePlainDate(calendarDateInTimeZone(new Date(), timeZone)) || new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: formatPlainDate(start),
    endDate: formatPlainDate(end),
  };
};

export const formatOccurrenceTiming = (
  occurrence: TeamScheduleOccurrence,
  timeZone = "UTC",
  includeTimeZone = true,
) =>
  new Date(occurrence.startsAt).toLocaleString(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(includeTimeZone ? { timeZoneName: "short" as const } : {}),
  });

export const getOccurrenceTimeZoneAbbreviation = (
  startsAt: string,
  timeZone: string,
): string => {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "";
};

export type SharedOccurrenceTiming = {
  sharedWeekday: string | null;
  sharedTime: string | null;
};

const occurrenceWeekdayLabel = (startsAt: string, timeZone: string) =>
  new Date(startsAt).toLocaleString(undefined, { timeZone, weekday: "short" });

const occurrenceTimeLabel = (startsAt: string, timeZone: string) =>
  new Date(startsAt).toLocaleString(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

const occurrenceWeekdayIndex = (startsAt: string, timeZone: string) =>
  new Date(startsAt).toLocaleString("en-US", { timeZone, weekday: "short" });

const occurrenceTimeKey = (startsAt: string, timeZone: string) =>
  new Date(startsAt).toLocaleString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });

export const getSharedOccurrenceTiming = (
  occurrences: TeamScheduleOccurrence[],
  timeZone = "UTC",
): SharedOccurrenceTiming => {
  if (occurrences.length === 0) {
    return { sharedWeekday: null, sharedTime: null };
  }

  const weekdayIndexes = occurrences.map((occurrence) =>
    occurrenceWeekdayIndex(occurrence.startsAt, timeZone),
  );
  const timeKeys = occurrences.map((occurrence) =>
    occurrenceTimeKey(occurrence.startsAt, timeZone),
  );
  const sharedWeekday = weekdayIndexes.every(
    (weekday) => weekday === weekdayIndexes[0],
  )
    ? occurrenceWeekdayLabel(occurrences[0].startsAt, timeZone)
    : null;
  const sharedTime = timeKeys.every((time) => time === timeKeys[0])
    ? occurrenceTimeLabel(occurrences[0].startsAt, timeZone)
    : null;

  return { sharedWeekday, sharedTime };
};

export const formatOccurrenceRowLabel = (
  occurrence: TeamScheduleOccurrence,
  shared: SharedOccurrenceTiming,
  timeZone = "UTC",
) => {
  if (!shared.sharedWeekday && !shared.sharedTime) {
    return formatOccurrenceTiming(occurrence, timeZone);
  }

  const date = new Date(occurrence.startsAt);
  const parts: string[] = [];

  if (!shared.sharedWeekday) {
    parts.push(occurrenceWeekdayLabel(occurrence.startsAt, timeZone));
  }

  parts.push(
    date.toLocaleString(undefined, {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  );

  if (!shared.sharedTime) {
    parts.push(occurrenceTimeLabel(occurrence.startsAt, timeZone));
  }

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
  return `${parts[0]}, ${parts[1]}, ${parts[2]}`;
};

export const getOccurrenceDate = (
  occurrence: Pick<TeamScheduleOccurrence, "serviceDate" | "occurrenceId" | "startsAt">,
  timeZone = "UTC",
) => {
  const storedDate =
    occurrence.serviceDate ||
    occurrence.occurrenceId.match(/^group:.+@(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (storedDate) return storedDate;
  const startsAt = new Date(occurrence.startsAt);
  return Number.isNaN(startsAt.getTime())
    ? ""
    : calendarDateInTimeZone(startsAt, timeZone);
};

/** YYYY-MM-DD for `date` in `timeZone` (en-CA is ISO-like and stable). */
export const calendarDateInTimeZone = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/**
 * True when the occurrence falls on the same calendar day as `referenceDate`
 * in `timeZone` — used to gate day-of-service controls like Make live.
 */
export const isOccurrenceOnCalendarDay = (
  occurrence: Pick<TeamScheduleOccurrence, "startsAt">,
  timeZone: string,
  referenceDate: Date = new Date(),
): boolean => {
  const startsAt = new Date(occurrence.startsAt);
  if (Number.isNaN(startsAt.getTime())) return false;
  return (
    calendarDateInTimeZone(startsAt, timeZone) ===
    calendarDateInTimeZone(referenceDate, timeZone)
  );
};

/**
 * Same-day check in the operator's local timezone — used for the schedule/plans
 * "Today" badge where UI dates already render with the browser locale.
 */
export const isOccurrenceToday = (
  occurrence: Pick<TeamScheduleOccurrence, "startsAt">,
  timeZone = "UTC",
  referenceDate: Date = new Date(),
): boolean =>
  isOccurrenceOnCalendarDay(occurrence, timeZone, referenceDate);

/**
 * The occurrence the operator is most likely to work next: the earliest one that
 * starts on or after `referenceMs` (defaults to now). Occurrences need not be
 * pre-sorted; returns null when every occurrence is in the past.
 */
export const findNextUpcomingOccurrenceId = (
  occurrences: TeamScheduleOccurrence[],
  referenceMs: number = Date.now(),
): string | null => {
  let bestId: string | null = null;
  let bestMs = Infinity;
  for (const occurrence of occurrences) {
    const ms = new Date(occurrence.startsAt).getTime();
    if (Number.isNaN(ms) || ms < referenceMs) continue;
    if (ms < bestMs) {
      bestMs = ms;
      bestId = occurrence.occurrenceId;
    }
  }
  return bestId;
};

/** Union of position requirements across a group, keeping the largest count per position. */
const mergeGroupedRequirements = (
  services: TeamService[],
): PositionRequirement[] => {
  const maxByPosition = new Map<string, PositionRequirement>();
  for (const service of services) {
    for (const req of service.positionRequirements || []) {
      const positionId = String(req?.positionId || "").trim();
      const count = Math.floor(Number(req?.count));
      if (!positionId || !Number.isFinite(count) || count < 1) continue;
      const existing = maxByPosition.get(positionId);
      // Take the busier service's requirement (and its level) for the shared slot.
      if (!existing || count > existing.count) {
        maxByPosition.set(positionId, {
          positionId,
          count,
          ...(req.minLevelId ? { minLevelId: String(req.minLevelId) } : {}),
        });
      }
    }
  }
  return [...maxByPosition.values()];
};

/**
 * Collapse occurrences of combined services (same `serviceGroupId`) that fall on
 * the same date into one occurrence, so a person assigned once covers every
 * service in the group that day. Ungrouped services — even on the same date — are
 * left untouched. The merged occurrence gets a stable group-based id, the
 * earliest start (for sorting/labels), the joined service names, and the union of
 * the grouped services' position requirements (max count per position).
 */
const mergeGroupedOccurrences = (
  occurrences: TeamScheduleOccurrence[],
  serviceById: Map<string, TeamService>,
): TeamScheduleOccurrence[] => {
  const standalone: TeamScheduleOccurrence[] = [];
  const buckets = new Map<string, TeamScheduleOccurrence[]>();
  for (const occurrence of occurrences) {
    const groupId = serviceById.get(occurrence.serviceId)?.serviceGroupId;
    if (!groupId) {
      standalone.push(occurrence);
      continue;
    }
    const key = `${groupId}@${getOccurrenceDate(occurrence)}`;
    const bucket = buckets.get(key) || [];
    bucket.push(occurrence);
    buckets.set(key, bucket);
  }

  const merged = [...buckets.values()].flatMap((bucket) => {
    // Only one grouped service lands on this date — there's nothing to combine, so
    // keep its plain per-service occurrence id instead of minting a group id that
    // would needlessly orphan existing assignments.
    if (bucket.length === 1) return bucket;
    const sorted = [...bucket].sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
        a.name.localeCompare(b.name),
    );
    const first = sorted[0];
    const groupId = serviceById.get(first.serviceId)?.serviceGroupId as string;
    const serviceIds = sorted.map((occurrence) => occurrence.serviceId);
    const names = [...new Set(sorted.map((occurrence) => occurrence.name))];
    const requirements = mergeGroupedRequirements(
      serviceIds
        .map((id) => serviceById.get(id))
        .filter(Boolean) as TeamService[],
    );
    const combined: TeamScheduleOccurrence = {
      occurrenceId: `group:${groupId}@${getOccurrenceDate(first)}`,
      serviceId: first.serviceId,
      groupId,
      serviceIds,
      name: names.join(" & "),
      startsAt: first.startsAt,
      serviceDate: getOccurrenceDate(first),
      ...(requirements.length ? { positionRequirements: requirements } : {}),
    };
    return [combined];
  });

  return [...standalone, ...merged];
};

export const generateScheduleOccurrences = ({
  services,
  serviceIds,
  startDate,
  endDate,
  timeZone = "UTC",
}: {
  services: TeamService[];
  serviceIds: string[];
  startDate: string;
  endDate: string;
  /** Church/service timezone, independent of the operator's browser timezone. */
  timeZone?: string;
}) => {
  const start = parsePlainDate(startDate);
  const end = parsePlainDate(endDate);
  if (!start || !end || start > end) return [];

  // Keep archived services so historical occurrences can still be resolved
  // (e.g. reopening a saved plan). Future dates after archivedAt are skipped below.
  const serviceById = new Map(services.map((service) => [service.serviceId, service]));
  const selectedServices = serviceIds
    .map((serviceId) => serviceById.get(serviceId))
    .filter((service): service is TeamService => Boolean(service));
  const endTime = new Date(end);
  endTime.setHours(23, 59, 59, 999);
  const occurrences: TeamScheduleOccurrence[] = [];

  for (const service of selectedServices) {
    const serviceStart = service.startDateISO
      ? parsePlainDate(service.startDateISO)
      : null;
    const serviceEnd = service.endDateISO
      ? parsePlainDate(service.endDateISO)
      : null;
    if (serviceEnd) serviceEnd.setHours(23, 59, 59, 999);
    const archivedAt = service.archivedAt
      ? new Date(service.archivedAt)
      : null;
    const withinServiceBounds = (date: Date) => {
      if (serviceStart && date < serviceStart) return false;
      if (serviceEnd && date > serviceEnd) return false;
      return true;
    };
    const pushOccurrence = (startsAt: Date, serviceDate: string) => {
      // Archived services remain in history but are unavailable after archive.
      if (archivedAt && !Number.isNaN(archivedAt.getTime()) && startsAt > archivedAt) {
        return;
      }
      occurrences.push(toOccurrence(service, startsAt, serviceDate));
    };

    if (service.reccurence === "one_time") {
      const startsAt = service.dateTimeISO
        ? new Date(service.dateTimeISO)
        : null;
      const serviceDate = startsAt && !Number.isNaN(startsAt.getTime())
        ? calendarDateInTimeZone(startsAt, timeZone)
        : "";
      if (startsAt && serviceDate >= startDate && serviceDate <= endDate) {
        pushOccurrence(startsAt, serviceDate);
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
        if (cursor.getDay() !== service.dayOfWeek) continue;
        if (!withinServiceBounds(cursor)) continue;
        const serviceDate = formatPlainDate(cursor);
        const startsAt = serviceDateTimeInTimeZone(serviceDate, service.time, timeZone);
        if (startsAt) pushOccurrence(startsAt, serviceDate);
      }
      continue;
    }

    if (service.reccurence === "multi_weekly") {
      const days = service.daysOfWeek || [];
      for (
        const cursor = new Date(start);
        cursor <= endTime;
        cursor.setDate(cursor.getDate() + 1)
      ) {
        if (!withinServiceBounds(cursor)) continue;
        const day = days.find((item) => item.day === cursor.getDay());
        if (day) {
          const serviceDate = formatPlainDate(cursor);
          const startsAt = serviceDateTimeInTimeZone(serviceDate, day.time, timeZone);
          if (startsAt) pushOccurrence(startsAt, serviceDate);
        }
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
          occurrenceDate > endTime ||
          !withinServiceBounds(occurrenceDate)
        )
          continue;
        const serviceDate = formatPlainDate(occurrenceDate);
        const startsAt = serviceDateTimeInTimeZone(serviceDate, service.time, timeZone);
        if (startsAt) pushOccurrence(startsAt, serviceDate);
      }
    }
  }

  return mergeGroupedOccurrences(occurrences, serviceById).sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      a.name.localeCompare(b.name),
  );
};

/**
 * Whether two occurrence lists describe the same set of occurrences by id. Used to
 * tell when a saved schedule's stored occurrences have drifted from what its
 * services + date range would generate now (e.g. services were combined or
 * un-combined after the schedule was saved), so the grid can offer a re-sync.
 */
export const occurrenceIdsMatch = (
  a: TeamScheduleOccurrence[],
  b: TeamScheduleOccurrence[],
): boolean => {
  if (a.length !== b.length) return false;
  const aIds = [...a.map((occurrence) => occurrence.occurrenceId)].sort();
  const bIds = [...b.map((occurrence) => occurrence.occurrenceId)].sort();
  return aIds.every((id, index) => id === bIds[index]);
};

/** Services that would produce at least one occurrence in the given plain-date range. */
export const filterServicesWithOccurrencesInRange = ({
  services,
  startDate,
  endDate,
  timeZone,
}: {
  services: TeamService[];
  startDate: string;
  endDate: string;
  timeZone?: string;
}) => {
  if (!startDate || !endDate) return [];
  return services.filter(
    (service) =>
      generateScheduleOccurrences({
        services,
        serviceIds: [service.serviceId],
        startDate,
        endDate,
        timeZone,
      }).length > 0,
  );
};
