import type {
  TeamRosterMember,
  TeamScheduleOccurrence,
  TeamScheduleSummary,
  TeamSchedule,
  TeamService,
} from "../../../api/authTypes";
import {
  calendarDateInTimeZone,
  generateScheduleOccurrences,
  matchOccurrencesByIdentity,
} from "../../../utils/teamScheduleOccurrences";
import { formatPlainDate, parsePlainDate } from "../../../utils/plainDate";

export type ServiceAvailabilityStatus = "available" | "unavailable" | null;

export type ServiceAvailabilityOccurrence = TeamScheduleOccurrence & {
  logicalOccurrenceId: string;
  serviceDate: string;
};

export type ServiceAvailabilityMonthRange = {
  startDate: string;
  endDate: string;
};

export type ServiceAvailabilityValue = {
  status: ServiceAvailabilityStatus;
  occurrenceIds: string[];
  hasConflictingValues: boolean;
};

export const getServiceAvailabilityMonthRange = (
  now: Date,
  timeZone: string,
  monthOffset = 0,
): ServiceAvailabilityMonthRange => {
  const currentDate = parsePlainDate(calendarDateInTimeZone(now, timeZone));
  if (!currentDate) return { startDate: "", endDate: "" };
  const firstDay = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + monthOffset,
    1,
  );
  const lastDay = new Date(firstDay.getFullYear(), firstDay.getMonth() + 2, 0);
  return {
    startDate: formatPlainDate(firstDay),
    endDate: formatPlainDate(lastDay),
  };
};

export const formatServiceAvailabilityMonthRange = (
  range: ServiceAvailabilityMonthRange,
) => {
  const start = new Date(`${range.startDate}T12:00:00.000Z`);
  const end = new Date(`${range.endDate}T12:00:00.000Z`);
  const startLabel = start.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  const endLabel = end.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  return start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
    ? startLabel
    : `${startLabel} – ${endLabel}`;
};

/**
 * Use the shared schedule generator for the church's complete service list.
 * A unique saved schedule identity is retained for legacy timestamp-keyed rows;
 * ambiguous legacy rows fall back to the current logical identity.
 */
export const getUpcomingServiceAvailabilityOccurrences = ({
  services,
  schedules,
  range,
  timeZone,
  now = new Date(),
}: {
  services: TeamService[];
  schedules: Array<TeamSchedule | TeamScheduleSummary>;
  range: ServiceAvailabilityMonthRange;
  timeZone: string;
  now?: Date;
}): ServiceAvailabilityOccurrence[] => {
  if (!range.startDate || !range.endDate || !timeZone) return [];
  const activeServices = services.filter((service) => !service.archivedAt);
  const generated = generateScheduleOccurrences({
    services: activeServices,
    serviceIds: activeServices.map((service) => service.serviceId),
    startDate: range.startDate,
    endDate: range.endDate,
    timeZone,
  }).filter((occurrence) => new Date(occurrence.startsAt).getTime() >= now.getTime());

  const savedById = new Map<string, TeamScheduleOccurrence>();
  schedules.forEach((schedule) => {
    (schedule.occurrences || []).forEach((occurrence) => {
      if (occurrence?.occurrenceId && !savedById.has(occurrence.occurrenceId)) {
        savedById.set(occurrence.occurrenceId, occurrence);
      }
    });
  });
  const savedOccurrences = [...savedById.values()];
  const { matches } = matchOccurrencesByIdentity(savedOccurrences, generated, timeZone);

  return generated.map((occurrence) => {
    const saved = matches.get(occurrence.occurrenceId);
    return {
      ...occurrence,
      ...(saved ? { occurrenceId: saved.occurrenceId } : {}),
      logicalOccurrenceId: occurrence.logicalOccurrenceId || occurrence.occurrenceId,
      serviceDate: occurrence.serviceDate || calendarDateInTimeZone(occurrence.startsAt, timeZone),
    };
  });
};

const isMatchingLegacyKey = (
  key: string,
  occurrence: ServiceAvailabilityOccurrence,
  timeZone: string,
) => {
  const separator = key.lastIndexOf("@");
  if (separator <= 0) return false;
  const prefix = key.slice(0, separator);
  const suffix = key.slice(separator + 1);
  const servicePrefixes = occurrence.groupId
    ? [
        `group:${occurrence.groupId}`,
        ...(occurrence.serviceIds || [occurrence.serviceId]),
      ]
    : [occurrence.serviceId];
  if (!servicePrefixes.includes(prefix)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(suffix)) {
    return suffix === occurrence.serviceDate;
  }
  const timestamp = new Date(suffix);
  return !Number.isNaN(timestamp.getTime()) &&
    calendarDateInTimeZone(timestamp, timeZone) === occurrence.serviceDate;
};

export const getServiceAvailabilityValue = (
  occurrence: ServiceAvailabilityOccurrence,
  availability: TeamRosterMember["serviceAvailability"],
  timeZone: string,
): ServiceAvailabilityValue => {
  const current = availability || {};
  const matchingIds = Object.keys(current).filter((key) =>
    key === occurrence.occurrenceId ||
    key === occurrence.logicalOccurrenceId ||
    isMatchingLegacyKey(key, occurrence, timeZone),
  );
  const orderedIds = [
    occurrence.occurrenceId,
    occurrence.logicalOccurrenceId,
    ...matchingIds,
  ].filter((id, index, all) => all.includes(id) && all.indexOf(id) === index);
  const savedIds = orderedIds.filter((id) => Object.hasOwn(current, id));
  const values = [...new Set(savedIds.map((id) => current[id]))];
  const preferredId = savedIds.includes(occurrence.occurrenceId)
    ? occurrence.occurrenceId
    : savedIds.includes(occurrence.logicalOccurrenceId)
      ? occurrence.logicalOccurrenceId
      : savedIds[0];
  const status = preferredId ? current[preferredId] : null;
  return {
    status: status === "available" || status === "unavailable" ? status : null,
    occurrenceIds: savedIds,
    hasConflictingValues: values.length > 1,
  };
};

export const formatServiceAvailabilityTime = (
  occurrence: TeamScheduleOccurrence,
  timeZone: string,
) => new Date(occurrence.startsAt).toLocaleTimeString(undefined, {
  timeZone,
  hour: "numeric",
  minute: "2-digit",
});

export const formatServiceAvailabilityDate = (
  occurrence: TeamScheduleOccurrence,
  timeZone: string,
) => new Date(occurrence.startsAt).toLocaleDateString(undefined, {
  timeZone,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export const groupServiceAvailabilityByDate = (
  occurrences: ServiceAvailabilityOccurrence[],
) => {
  const groups = new Map<string, ServiceAvailabilityOccurrence[]>();
  occurrences.forEach((occurrence) => {
    const current = groups.get(occurrence.serviceDate) || [];
    current.push(occurrence);
    groups.set(occurrence.serviceDate, current);
  });
  return [...groups.entries()].map(([date, services]) => ({ date, services }));
};
