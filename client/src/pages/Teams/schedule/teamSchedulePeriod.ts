import type {
  PositionRequirement,
  TeamPosition,
  TeamScheduleOccurrence,
  TeamSchedule,
  TeamScheduleSummary,
  TeamService,
} from "../../../api/authTypes";
import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";
import { calendarDateInTimeZone } from "../../../utils/teamScheduleOccurrences";
import { generateScheduleOccurrences, getOccurrenceDate } from "@/utils/teamScheduleOccurrences";
import {
  parseSlotKey,
  resolveOccurrenceRequirements,
  sanitizePositionRequirements,
} from "./scheduleRequirements";
import { isHydratedSchedule } from "../../../api/authTypes";
import { calendarMonthRange } from "../rangeSelection";
import { serverDate } from "@/utils/serverTime";

export type TeamSchedulePeriod = {
  occurrences: TeamScheduleOccurrence[];
  /** Generated set after filtering to services relevant to this team. */
  allOccurrences: TeamScheduleOccurrence[];
  serviceIds: string[];
  requirementsByOccurrence: Map<string, PositionRequirement[]>;
};

/** Build the one generated occurrence set needed by a team's period workspace. */
export const buildTeamSchedulePeriod = ({
  services,
  positions,
  teamId,
  startDate,
  endDate,
  additionalPositionSlots,
}: {
  services: TeamService[];
  positions: TeamPosition[];
  teamId: string;
  startDate: string;
  endDate: string;
  additionalPositionSlots?: Record<string, string[]>;
}): TeamSchedulePeriod => {
  const teamPositionIds = positions
    .filter((position) => position.teamId === teamId)
    .map((position) => position.positionId);
  const teamPositionIdSet = new Set(teamPositionIds);
  const activeServices = services.filter((service) => !service.archivedAt);
  const explicitTeamOccurrenceIds = Object.entries(additionalPositionSlots || {})
    .filter(([, slotKeys]) => slotKeys.some((slotKey) => {
      const slot = parseSlotKey(slotKey);
      return Boolean(slot && teamPositionIdSet.has(slot.positionId));
    }))
    .map(([occurrenceId]) => occurrenceId);
  const explicitlyStaffedServiceIds = new Set<string>();
  for (const service of activeServices) {
    const ownOccurrences = generateScheduleOccurrences({
      services: [service],
      serviceIds: [service.serviceId],
      startDate,
      endDate,
    });
    if (ownOccurrences.some((occurrence) =>
      explicitTeamOccurrenceIds.includes(occurrence.occurrenceId) ||
      Boolean(service.serviceGroupId && explicitTeamOccurrenceIds.includes(
        `group:${service.serviceGroupId}@${getOccurrenceDate(occurrence)}`,
      )),
    )) explicitlyStaffedServiceIds.add(service.serviceId);
  }
  const teamRelevantServices = activeServices.filter((service) =>
    sanitizePositionRequirements(service.positionRequirements).some((requirement) =>
      teamPositionIdSet.has(requirement.positionId),
    ) || explicitlyStaffedServiceIds.has(service.serviceId),
  );
  const serviceById = new Map(teamRelevantServices.map((service) => [service.serviceId, service]));
  const generated = generateScheduleOccurrences({
    services: teamRelevantServices,
    serviceIds: teamRelevantServices.map((service) => service.serviceId),
    startDate,
    endDate,
  });
  const occurrences: TeamScheduleOccurrence[] = [];
  const requirementsByOccurrence = new Map<string, PositionRequirement[]>();
  const serviceIds = new Set<string>();

  generated.forEach((occurrence) => {
    const service = serviceById.get(occurrence.serviceId);
    const requirements = resolveOccurrenceRequirements({
      occurrence,
      service,
      teamPositionIds,
      fallbackToAllTeamPositions: false,
    });
    const hasExplicitTeamSlot = (additionalPositionSlots?.[occurrence.occurrenceId] || [])
      .some((slotKey) => {
        const slot = parseSlotKey(slotKey);
        return Boolean(slot && teamPositionIdSet.has(slot.positionId));
      });
    if (requirements.length === 0 && !hasExplicitTeamSlot) return;

    occurrences.push(occurrence);
    requirementsByOccurrence.set(occurrence.occurrenceId, requirements);
    (occurrence.serviceIds || [occurrence.serviceId]).forEach((serviceId) => serviceIds.add(serviceId));
  });

  return {
    occurrences,
    allOccurrences: generated,
    serviceIds: [...serviceIds],
    requirementsByOccurrence,
  };
};

/** Resolve Upcoming to the full month of the next occurrence that needs this team. */
export const findInitialTeamSchedulePeriod = ({
  services,
  positions,
  teamId,
  schedules = [],
  now = serverDate(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
}: {
  services: TeamService[];
  positions: TeamPosition[];
  teamId: string;
  schedules?: Array<TeamSchedule | TeamScheduleSummary>;
  now?: Date;
  timeZone?: string;
}): {
  start: string;
  end: string;
  preset: "upcoming";
  period: TeamSchedulePeriod;
  nextOccurrence: TeamScheduleOccurrence | null;
} => {
  const todayDate = parsePlainDate(calendarDateInTimeZone(now, timeZone));
  const today = todayDate || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const teamPositionIds = new Set(positions
    .filter((position) => position.teamId === teamId)
    .map((position) => position.positionId));
  const additionalPositionSlots = schedules
    .filter((schedule): schedule is TeamSchedule =>
      !schedule.archivedAt &&
      schedule.teamId === teamId &&
      isHydratedSchedule(schedule),
    )
    .reduce<Record<string, string[]>>((slots, schedule) => {
      Object.entries(schedule.additionalPositionSlots || {}).forEach(([occurrenceId, keys]) => {
        slots[occurrenceId] = [...(slots[occurrenceId] || []), ...keys];
      });
      return slots;
    }, {});
  const relevantServices = services.filter((service) => !service.archivedAt &&
    sanitizePositionRequirements(service.positionRequirements).some((requirement) =>
      teamPositionIds.has(requirement.positionId),
    ));
  const searchDates = relevantServices.flatMap((service) => [
    service.startDateISO,
    ...(service.reccurence === "one_time" ? [service.dateTimeISO?.slice(0, 10)] : []),
  ]).filter((value): value is string => Boolean(value)).sort();
  const searchHorizon = new Date(today);
  searchHorizon.setFullYear(searchHorizon.getFullYear() + 1);
  const searchEnd = [formatPlainDate(searchHorizon), searchDates[searchDates.length - 1] || ""]
    .sort()
    .at(-1) || formatPlainDate(searchHorizon);
  const scanStart = formatPlainDate(today);
  const generatedFuture = generateScheduleOccurrences({
    services: relevantServices,
    serviceIds: relevantServices.map((service) => service.serviceId),
    startDate: scanStart,
    endDate: searchEnd,
  });
  const savedFuture = schedules
    .filter((schedule) => !schedule.archivedAt && schedule.teamId === teamId)
    .flatMap((schedule) => {
      const additionalSlots = "additionalPositionSlots" in schedule
        ? schedule.additionalPositionSlots
        : undefined;
      return (schedule.occurrences || []).filter((occurrence) => {
        const hasTeamRequirement = sanitizePositionRequirements(occurrence.positionRequirements)
          .some((requirement) => teamPositionIds.has(requirement.positionId));
        const hasTeamSlot = (additionalSlots?.[occurrence.occurrenceId] || [])
          .some((slotKey: string) => {
            const slot = parseSlotKey(slotKey);
            return Boolean(slot && teamPositionIds.has(slot.positionId));
          });
        const startsAt = Date.parse(occurrence.startsAt);
        return Number.isFinite(startsAt) && startsAt >= now.getTime() &&
          (hasTeamRequirement || hasTeamSlot);
      });
    });
  const nextOccurrence = [...generatedFuture, ...savedFuture]
    .filter((occurrence) => {
      const startsAt = Date.parse(occurrence.startsAt);
      return Number.isFinite(startsAt) && startsAt >= now.getTime();
    })
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0] || null;
  const nextDate = nextOccurrence
    ? parsePlainDate(calendarDateInTimeZone(new Date(nextOccurrence.startsAt), timeZone))
    : null;
  const range = calendarMonthRange(nextDate || today);
  const period = buildTeamSchedulePeriod({
    services,
    positions,
    teamId,
    startDate: range.start,
    endDate: range.end,
    additionalPositionSlots,
  });
  if (
    nextOccurrence &&
    calendarDateInTimeZone(new Date(nextOccurrence.startsAt), timeZone) !== getOccurrenceDate(nextOccurrence) &&
    !period.occurrences.some((occurrence) => occurrence.occurrenceId === nextOccurrence.occurrenceId)
  ) {
    const occurrenceDate = calendarDateInTimeZone(new Date(nextOccurrence.startsAt), timeZone);
    if (occurrenceDate >= range.start && occurrenceDate <= range.end) {
      const service = relevantServices.find((item) => item.serviceId === nextOccurrence.serviceId);
      const requirements = resolveOccurrenceRequirements({
        occurrence: nextOccurrence,
        service,
        teamPositionIds: [...teamPositionIds],
        fallbackToAllTeamPositions: false,
      });
      if (requirements.length > 0) {
        period.occurrences.push(nextOccurrence);
        period.allOccurrences.push(nextOccurrence);
        period.requirementsByOccurrence.set(nextOccurrence.occurrenceId, requirements);
        const serviceIds = nextOccurrence.serviceIds || [nextOccurrence.serviceId];
        serviceIds.forEach((serviceId) => {
          if (!period.serviceIds.includes(serviceId)) period.serviceIds.push(serviceId);
        });
      }
    }
  }
  return {
    start: range.start,
    end: range.end,
    preset: "upcoming",
    period,
    nextOccurrence,
  };
};
