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
  teamIds,
  startDate,
  endDate,
  additionalPositionSlots,
  schedules = [],
  timeZone,
}: {
  services: TeamService[];
  positions: TeamPosition[];
  teamId?: string;
  teamIds?: string[];
  startDate: string;
  endDate: string;
  additionalPositionSlots?: Record<string, string[]>;
  schedules?: Array<TeamSchedule | TeamScheduleSummary>;
  timeZone?: string;
}): TeamSchedulePeriod => {
  const selectedTeamIds = [...new Set(teamIds?.length ? teamIds : teamId ? [teamId] : [])];
  const positionIdsByTeam = new Map(selectedTeamIds.map((id) => [
    id,
    new Set(positions
      .filter((position) => position.teamId === id)
      .map((position) => position.positionId)),
  ]));
  const teamPositionIds = new Set([...positionIdsByTeam.values()].flatMap((ids) => [...ids]));
  const activeServices = services.filter((service) => !service.archivedAt);
  const allServiceById = new Map(activeServices.map((service) => [service.serviceId, service]));
  const selectedSchedules = schedules
    .filter((schedule) => !schedule.archivedAt && selectedTeamIds.includes(schedule.teamId))
    .sort((left, right) => {
      const leftUpdatedAt = "updatedAt" in left ? String(left.updatedAt || "") : "";
      const rightUpdatedAt = "updatedAt" in right ? String(right.updatedAt || "") : "";
      return leftUpdatedAt.localeCompare(rightUpdatedAt);
    });
  const scheduleOccurrencesByTeam = new Map<string, TeamScheduleOccurrence[]>();
  const additionalSlotsByTeam = new Map<string, Map<string, Set<string>>>();
  const addSlots = (teamIdForSlots: string, slots: Record<string, string[]> = {}) => {
    const byOccurrence = additionalSlotsByTeam.get(teamIdForSlots) || new Map<string, Set<string>>();
    Object.entries(slots).forEach(([occurrenceId, keys]) => {
      const slotKeys = byOccurrence.get(occurrenceId) || new Set<string>();
      keys.forEach((key) => slotKeys.add(key));
      byOccurrence.set(occurrenceId, slotKeys);
    });
    additionalSlotsByTeam.set(teamIdForSlots, byOccurrence);
  };
  selectedSchedules.forEach((schedule) => {
    const scheduleTeamId = schedule.teamId;
    const occurrences = (schedule.occurrences || []).filter(Boolean);
    scheduleOccurrencesByTeam.set(scheduleTeamId, [
      ...(scheduleOccurrencesByTeam.get(scheduleTeamId) || []),
      ...occurrences,
    ]);
    if ("additionalPositionSlots" in schedule) {
      addSlots(scheduleTeamId, schedule.additionalPositionSlots || {});
    }
  });
  if (additionalPositionSlots && selectedTeamIds.length) {
    addSlots(teamId && selectedTeamIds.includes(teamId) ? teamId : selectedTeamIds[0], additionalPositionSlots);
  }

  const hasTeamSlot = (teamIdForSlots: string, occurrenceIds: string[]) => {
    const positionIds = positionIdsByTeam.get(teamIdForSlots) || new Set<string>();
    const slotsByOccurrence = additionalSlotsByTeam.get(teamIdForSlots);
    return occurrenceIds.some((occurrenceId) =>
      [...(slotsByOccurrence?.get(occurrenceId) || [])].some((slotKey) => {
        const slot = parseSlotKey(slotKey);
        return Boolean(slot && positionIds.has(slot.positionId));
      }),
    );
  };

  const relevantServiceIds = new Set<string>();
  activeServices.forEach((service) => {
    if (sanitizePositionRequirements(service.positionRequirements).some((requirement) =>
      teamPositionIds.has(requirement.positionId),
    )) relevantServiceIds.add(service.serviceId);
  });
  for (const [scheduleTeamId, occurrences] of scheduleOccurrencesByTeam) {
    const teamPositionIdsForSchedule = [...(positionIdsByTeam.get(scheduleTeamId) || [])];
    for (const occurrence of occurrences) {
      const occurrenceServiceIds = occurrence.serviceIds?.length
        ? occurrence.serviceIds
        : [occurrence.serviceId];
      const hasRelevantRequirement = occurrenceServiceIds.some((serviceId) =>
        resolveOccurrenceRequirements({
          occurrence,
          service: allServiceById.get(serviceId),
          teamPositionIds: teamPositionIdsForSchedule,
          fallbackToAllTeamPositions: false,
        }).length > 0,
      );
      const hasRelevantSlot = hasTeamSlot(scheduleTeamId, [occurrence.occurrenceId]);
      if (hasRelevantRequirement || hasRelevantSlot) {
        occurrenceServiceIds.forEach((serviceId) => relevantServiceIds.add(serviceId));
      }
    }
  }
  for (const service of activeServices) {
    const ownOccurrences = generateScheduleOccurrences({
      services: [service],
      serviceIds: [service.serviceId],
      startDate,
      endDate,
      timeZone,
    });
    if (ownOccurrences.some((occurrence) => selectedTeamIds.some((selectedTeamId) =>
      hasTeamSlot(selectedTeamId, [
        occurrence.occurrenceId,
        ...(service.serviceGroupId
          ? [`group:${service.serviceGroupId}@${getOccurrenceDate(occurrence, timeZone)}`]
          : []),
      ]),
    ))) relevantServiceIds.add(service.serviceId);
  }
  const teamRelevantServices = activeServices.filter((service) => relevantServiceIds.has(service.serviceId));
  const serviceById = new Map(teamRelevantServices.map((service) => [service.serviceId, service]));
  const generated = generateScheduleOccurrences({
    services: teamRelevantServices,
    serviceIds: teamRelevantServices.map((service) => service.serviceId),
    startDate,
    endDate,
    timeZone,
  });
  const occurrences: TeamScheduleOccurrence[] = [];
  const requirementsByOccurrence = new Map<string, PositionRequirement[]>();
  const serviceIds = new Set<string>();

  generated.forEach((occurrence) => {
    const occurrenceServiceIds = occurrence.serviceIds?.length
      ? occurrence.serviceIds
      : [occurrence.serviceId];
    const occurrenceDate = getOccurrenceDate(occurrence, timeZone);
    const requirementsByPosition = new Map<string, PositionRequirement>();
    let relevant = false;
    selectedTeamIds.forEach((selectedTeamId) => {
      const teamPositionIdsForSchedule = [...(positionIdsByTeam.get(selectedTeamId) || [])];
      const savedOccurrences = (scheduleOccurrencesByTeam.get(selectedTeamId) || []).filter((saved) =>
        getOccurrenceDate(saved, timeZone) === occurrenceDate &&
        (saved.serviceIds?.length ? saved.serviceIds : [saved.serviceId])
          .some((serviceId) => occurrenceServiceIds.includes(serviceId)),
      );
      const teamRequirements = new Map<string, PositionRequirement>();
      occurrenceServiceIds.forEach((serviceId) => {
        const service = serviceById.get(serviceId);
        const serviceOccurrences = savedOccurrences.filter((saved) =>
          (saved.serviceIds?.length ? saved.serviceIds : [saved.serviceId]).includes(serviceId),
        );
        const requirementSources = serviceOccurrences.length ? serviceOccurrences : [null];
        requirementSources.forEach((saved) => {
          resolveOccurrenceRequirements({
            occurrence: saved,
            service,
            teamPositionIds: teamPositionIdsForSchedule,
            fallbackToAllTeamPositions: false,
          }).forEach((requirement) => {
            const current = teamRequirements.get(requirement.positionId);
            if (!current || current.count < requirement.count) teamRequirements.set(requirement.positionId, requirement);
          });
        });
      });
      const savedOccurrenceIds = savedOccurrences.map(({ occurrenceId }) => occurrenceId);
      const hasExplicitTeamSlot = hasTeamSlot(selectedTeamId, [occurrence.occurrenceId, ...savedOccurrenceIds]);
      if (!teamRequirements.size && !hasExplicitTeamSlot) return;
      relevant = true;
      teamRequirements.forEach((requirement, positionId) => {
        const current = requirementsByPosition.get(positionId);
        if (!current || current.count < requirement.count) requirementsByPosition.set(positionId, requirement);
      });
    });
    if (!relevant) return;

    const requirements = [...requirementsByPosition.values()];
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
  timeZone = "UTC",
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
    ...(service.reccurence === "one_time" && service.dateTimeISO
      ? [calendarDateInTimeZone(new Date(service.dateTimeISO), timeZone)]
      : []),
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
    timeZone,
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
    timeZone,
  });
  if (
    nextOccurrence &&
    calendarDateInTimeZone(new Date(nextOccurrence.startsAt), timeZone) !== getOccurrenceDate(nextOccurrence, timeZone) &&
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
