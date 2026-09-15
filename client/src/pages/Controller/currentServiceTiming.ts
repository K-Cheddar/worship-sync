import type { TeamScheduleOccurrence } from "../../api/authTypes";
import type { ServiceTime, Weekday } from "../../types";
import { formatPlainDate, parsePlainDate } from "../../utils/plainDate";
import { serverDate } from "../../utils/serverTime";
import {
  resolveServicePlanEndMs,
  type ServicePlanTimingSource,
} from "../Services/servicePlanTimingUtils";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 60 * 60_000;

export type OccurrenceServiceStart = {
  service: ServiceTime;
  targetMs: number;
};

export type CurrentServiceTimingState =
  | {
      type: "upcoming-service";
      service: ServiceTime;
      targetMs: number;
    }
  | {
      type: "service-ending";
      targetMs: number;
    }
  | {
      type: "overtime";
      targetMs: number;
    }
  | {
      type: "live";
    };

const parseTimeToMinutes = (time?: string): number | null => {
  if (!time || !TIME_PATTERN.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const getOccurrenceDate = (
  occurrence: TeamScheduleOccurrence,
): Date | null => {
  const startsAtMs = Date.parse(occurrence.startsAt);
  if (!Number.isFinite(startsAtMs)) return null;
  const startsAt = new Date(startsAtMs);
  return new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate());
};

const getDateKey = (date: Date): string => formatPlainDate(date);

const isWithinServiceBounds = (date: Date, service: ServiceTime): boolean => {
  const start = service.startDateISO ? parsePlainDate(service.startDateISO) : null;
  const end = service.endDateISO ? parsePlainDate(service.endDateISO) : null;
  if (service.startDateISO && !start) return false;
  if (service.endDateISO && !end) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
};

const setTimeOnDate = (date: Date, time?: string): number | null => {
  const minutes = parseTimeToMinutes(time);
  if (minutes == null) return null;
  const result = new Date(date);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  const timestamp = result.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isSameCalendarDate = (leftMs: number, rightDate: Date): boolean =>
  getDateKey(new Date(leftMs)) === getDateKey(rightDate);

const nthWeekdayOfMonth = (
  year: number,
  month: number,
  ordinal: 1 | 2 | 3 | 4 | 5,
  weekday: Weekday,
): Date | null => {
  if (ordinal === 5) {
    const last = new Date(year, month + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    last.setDate(last.getDate() - offset);
    return last;
  }

  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const result = new Date(year, month, 1 + offset + (ordinal - 1) * 7);
  return result.getMonth() === month ? result : null;
};

const resolveScheduledServiceStartMs = (
  occurrence: TeamScheduleOccurrence,
  occurrenceDate: Date,
  service: ServiceTime,
): number | null => {
  const occurrenceStartsAtMs = Date.parse(occurrence.startsAt);

  // The representative service's occurrence timestamp is authoritative. This
  // also keeps a manually selected occurrence stable if service metadata was
  // edited after the schedule was generated.
  if (
    service.id === occurrence.serviceId &&
    Number.isFinite(occurrenceStartsAtMs)
  ) {
    return occurrenceStartsAtMs;
  }

  if (!isWithinServiceBounds(occurrenceDate, service)) return null;

  if (service.reccurence === "one_time") {
    const scheduledMs = service.dateTimeISO
      ? Date.parse(service.dateTimeISO)
      : Number.NaN;
    return Number.isFinite(scheduledMs) && isSameCalendarDate(scheduledMs, occurrenceDate)
      ? scheduledMs
      : null;
  }

  if (service.reccurence === "weekly") {
    return service.dayOfWeek === occurrenceDate.getDay()
      ? setTimeOnDate(occurrenceDate, service.time)
      : null;
  }

  if (service.reccurence === "multi_weekly") {
    const matchingTimes = (service.daysOfWeek || [])
      .filter((entry) => entry.day === occurrenceDate.getDay())
      .map((entry) => setTimeOnDate(occurrenceDate, entry.time))
      .filter((timestamp): timestamp is number => timestamp !== null);
    return matchingTimes.length ? Math.min(...matchingTimes) : null;
  }

  if (
    service.reccurence === "monthly" &&
    service.ordinal != null &&
    service.weekday != null
  ) {
    const expectedDate = nthWeekdayOfMonth(
      occurrenceDate.getFullYear(),
      occurrenceDate.getMonth(),
      service.ordinal,
      service.weekday,
    );
    return expectedDate && expectedDate.getDate() === occurrenceDate.getDate()
      ? setTimeOnDate(occurrenceDate, service.time)
      : null;
  }

  // The recurrence branches above intentionally do not ask a generic "next
  // occurrence" helper for another calendar date.
  return null;
};

const resolveServiceStartMs = (
  occurrence: TeamScheduleOccurrence,
  occurrenceDate: Date,
  service: ServiceTime,
  nowMs: number,
): number | null => {
  const scheduledMs = resolveScheduledServiceStartMs(
    occurrence,
    occurrenceDate,
    service,
  );

  if (service.overrideDateTimeISO) {
    const overrideMs = Date.parse(service.overrideDateTimeISO);
    const isSameOccurrenceDate =
      Number.isFinite(overrideMs) &&
      isSameCalendarDate(overrideMs, occurrenceDate);
    // TimeAdjuster applies an absolute future override. Permit a cross-midnight
    // adjustment (23:58 -> 00:03) while keeping a later recurring occurrence
    // out of this pinned occurrence's scope.
    const isCloseToScheduledStart =
      Number.isFinite(overrideMs) &&
      scheduledMs != null &&
      Math.abs(overrideMs - scheduledMs) <= DAY_MS;
    if (
      Number.isFinite(overrideMs) &&
      overrideMs > nowMs &&
      (isSameOccurrenceDate || isCloseToScheduledStart)
    ) {
      return overrideMs;
    }
  }

  return scheduledMs;
};

/**
 * Resolves linked service starts for the selected occurrence. Scheduled
 * recurrence starts stay on that occurrence's date; an explicit future
 * override may cross midnight when it remains close to that scheduled start.
 * It does not search forward, so recurring group members cannot switch the
 * header to next week's service after today's occurrence has passed.
 */
export const resolveOccurrenceServiceStarts = (
  occurrence: TeamScheduleOccurrence | null,
  occurrenceServices: ServiceTime[],
  nowMs = serverDate().getTime(),
): OccurrenceServiceStart[] => {
  if (!occurrence) return [];
  const occurrenceDate = getOccurrenceDate(occurrence);
  if (!occurrenceDate) return [];

  return occurrenceServices
    .map((service, index) => ({
      service,
      targetMs: resolveServiceStartMs(
        occurrence,
        occurrenceDate,
        service,
        nowMs,
      ),
      index,
    }))
    .filter(
      (entry): entry is OccurrenceServiceStart & { index: number } =>
        entry.targetMs !== null && Number.isFinite(entry.targetMs),
    )
    .sort(
      (left, right) =>
        left.targetMs - right.targetMs || left.index - right.index,
    )
    .map(({ service, targetMs }) => ({ service, targetMs }));
};

export const resolveCurrentServiceTimingState = ({
  occurrence,
  occurrenceServices,
  plan,
  nowMs,
}: {
  occurrence: TeamScheduleOccurrence | null;
  occurrenceServices: ServiceTime[];
  plan: ServicePlanTimingSource | null | undefined;
  nowMs: number;
}): CurrentServiceTimingState => {
  if (!occurrence) return { type: "live" };

  const nextService = resolveOccurrenceServiceStarts(
    occurrence,
    occurrenceServices,
    nowMs,
  ).find(({ targetMs }) => targetMs > nowMs);
  if (nextService) {
    return {
      type: "upcoming-service",
      service: nextService.service,
      targetMs: nextService.targetMs,
    };
  }

  const occurrenceStartsAtMs = Date.parse(occurrence.startsAt);
  const planEndMs = plan
    ? resolveServicePlanEndMs(plan, occurrenceStartsAtMs)
    : null;
  if (planEndMs == null) return { type: "live" };
  return nowMs < planEndMs
    ? { type: "service-ending", targetMs: planEndMs }
    : { type: "overtime", targetMs: planEndMs };
};

/** Format elapsed time with a visible `MM:SS` at and below one hour. */
export const formatCurrentServiceOvertime = (
  targetMs: number,
  nowMs: number,
): string => {
  const totalSeconds = Math.max(0, Math.floor((nowMs - targetMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};
