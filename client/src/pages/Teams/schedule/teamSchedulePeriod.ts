import type {
  PositionRequirement,
  TeamPosition,
  TeamScheduleOccurrence,
  TeamSchedule,
  TeamScheduleSummary,
  TeamService,
} from "../../../api/authTypes";
import { formatPlainDate, parsePlainDate } from "../../../utils/plainDate";
import { calendarDateInTimeZone } from "../../../utils/teamScheduleOccurrences";
import {
  generateScheduleOccurrences,
  getOccurrenceDate,
  matchOccurrencesByIdentity,
} from "../../../utils/teamScheduleOccurrences";
import {
  parseSlotKey,
  resolveOccurrenceRequirements,
  sanitizePositionRequirements,
} from "./scheduleRequirements";
import { isHydratedSchedule } from "../../../api/authTypes";
import { calendarMonthRange } from "../rangeSelection";
import { serverDate } from "../../../utils/serverTime";

export type TeamSchedulePeriod = {
  occurrences: TeamScheduleOccurrence[];
  /** Complete generated set, with combined membership resolved before team filtering. */
  allOccurrences: TeamScheduleOccurrence[];
  serviceIds: string[];
  requirementsByOccurrence: Map<string, PositionRequirement[]>;
};

/** Generate complete church groups first, then project only this team's staffing requirements. */
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
  const hasStoredLegacySlotForOccurrence = (teamIdForSlots: string, occurrence: TeamScheduleOccurrence) => {
    if (occurrence.groupId) return false;
    const slotKeys = additionalSlotsByTeam.get(teamIdForSlots);
    if (!slotKeys?.size) return false;
    return [...slotKeys.keys()].some((storedId) => {
      const legacy = storedId.match(/^(.+)@(.+)$/);
      if (!legacy || legacy[1] !== occurrence.serviceId) return false;
      const instant = new Date(legacy[2]);
      return !Number.isNaN(instant.getTime()) &&
        calendarDateInTimeZone(instant, timeZone || "UTC") === getOccurrenceDate(occurrence, timeZone);
    });
  };

  const generated = generateScheduleOccurrences({
    services: activeServices,
    serviceIds: activeServices.map((service) => service.serviceId),
    startDate,
    endDate,
    timeZone,
  });
  const occurrences: TeamScheduleOccurrence[] = [];
  const requirementsByOccurrence = new Map<string, PositionRequirement[]>();
  const serviceIds = new Set<string>();

  generated.forEach((occurrence) => {
    const occurrenceServiceIds = occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId];
    const matchedSavedOccurrenceIds = new Set<string>();
    let hasAmbiguousPersistedKeyCollision = false;
    const requirementsByPosition = new Map<string, PositionRequirement>();
    let relevant = false;
    selectedTeamIds.forEach((selectedTeamId) => {
      const teamPositionIdsForSchedule = [...(positionIdsByTeam.get(selectedTeamId) || [])];
      const teamScheduleOccurrences = scheduleOccurrencesByTeam.get(selectedTeamId) || [];
      const identityMatch = matchOccurrencesByIdentity(teamScheduleOccurrences, [occurrence], timeZone);
      const savedMatch = identityMatch.matches.get(occurrence.occurrenceId);
      if (!savedMatch && identityMatch.ambiguousCurrentIds.has(occurrence.occurrenceId) &&
          teamScheduleOccurrences.some((saved) => saved.occurrenceId === occurrence.occurrenceId)) {
        hasAmbiguousPersistedKeyCollision = true;
      }
      if (savedMatch) {
        matchedSavedOccurrenceIds.add(savedMatch.occurrenceId);
      }
      const teamRequirements = new Map<string, PositionRequirement>();
      occurrenceServiceIds.forEach((serviceId) => {
        const service = allServiceById.get(serviceId);
        resolveOccurrenceRequirements({
          occurrence: savedMatch || occurrence,
          service,
          teamPositionIds: teamPositionIdsForSchedule,
          fallbackToAllTeamPositions: false,
        }).forEach((requirement) => {
          const current = teamRequirements.get(requirement.positionId);
          if (!current || current.count < requirement.count) teamRequirements.set(requirement.positionId, requirement);
        });
      });
      const hasExplicitTeamSlot = hasTeamSlot(selectedTeamId, [
        occurrence.occurrenceId,
        ...(savedMatch ? [savedMatch.occurrenceId] : []),
      ]) || hasStoredLegacySlotForOccurrence(selectedTeamId, occurrence);
      if (!teamRequirements.size && !hasExplicitTeamSlot) return;
      relevant = true;
      teamRequirements.forEach((requirement, positionId) => {
        const current = requirementsByPosition.get(positionId);
        if (!current || current.count < requirement.count) requirementsByPosition.set(positionId, requirement);
      });
    });
    if (!relevant || hasAmbiguousPersistedKeyCollision) return;

    const requirements = [...requirementsByPosition.values()];
    // A single team view has one safe legacy key. A union view with different
    // per-team keys cannot choose one key for every saved assignment map.
    const displayOccurrence = matchedSavedOccurrenceIds.size === 1
      ? { ...occurrence, occurrenceId: [...matchedSavedOccurrenceIds][0] }
      : occurrence;
    occurrences.push({
      ...displayOccurrence,
      positionRequirements: requirements,
    });
    requirementsByOccurrence.set(displayOccurrence.occurrenceId, requirements);
    occurrenceServiceIds.forEach((serviceId) => serviceIds.add(serviceId));
  });

  // Keep unmatched persisted rows in the period so their existing assignment
  // and equipment map keys remain visible while a caller surfaces ambiguity.
  selectedSchedules.forEach((schedule) => {
    const teamPositionIds = positionIdsByTeam.get(schedule.teamId) || new Set<string>();
    const safelyMatchedIds = matchOccurrencesByIdentity(
      scheduleOccurrencesByTeam.get(schedule.teamId) || [],
      generated,
      timeZone,
    ).matchedStoredIds;
    (schedule.occurrences || []).forEach((saved) => {
      if (safelyMatchedIds.has(saved.occurrenceId) ||
          occurrences.some((occurrence) => occurrence.occurrenceId === saved.occurrenceId)) return;
      const savedDate = getOccurrenceDate(saved, timeZone);
      if (!savedDate || savedDate < startDate || savedDate > endDate) return;
      const requirementsByPosition = new Map<string, PositionRequirement>();
      sanitizePositionRequirements(saved.positionRequirements)
        .filter((requirement) => teamPositionIds.has(requirement.positionId))
        .forEach((requirement) => requirementsByPosition.set(requirement.positionId, requirement));
      if (requirementsByPosition.size === 0) {
        (saved.serviceIds?.length ? saved.serviceIds : [saved.serviceId]).forEach((serviceId) => {
          const currentService = allServiceById.get(serviceId);
          sanitizePositionRequirements(currentService?.positionRequirements)
            .filter((requirement) => teamPositionIds.has(requirement.positionId))
            .forEach((requirement) => requirementsByPosition.set(requirement.positionId, requirement));
        });
      }
      const savedSlotKeys = [
        ...("assignments" in schedule ? Object.keys(schedule.assignments?.[saved.occurrenceId] || {}) : []),
        ...("responses" in schedule ? Object.keys(schedule.responses?.[saved.occurrenceId] || {}) : []),
        ...("microphoneAssignments" in schedule
          ? Object.keys(schedule.microphoneAssignments?.[saved.occurrenceId] || {})
          : []),
        ...("iemAssignments" in schedule
          ? Object.keys(schedule.iemAssignments?.[saved.occurrenceId] || {})
          : []),
        ...("additionalPositionSlots" in schedule
          ? schedule.additionalPositionSlots?.[saved.occurrenceId] || []
          : []),
      ];
      let hasTeamStoredData = false;
      savedSlotKeys.forEach((slotKey) => {
        const slot = parseSlotKey(slotKey);
        if (!slot || !teamPositionIds.has(slot.positionId)) return;
        hasTeamStoredData = true;
        const current = requirementsByPosition.get(slot.positionId);
        const count = Math.max(current?.count || 0, slot.slot + 1);
        if (!current || current.count < count) {
          requirementsByPosition.set(slot.positionId, { positionId: slot.positionId, count });
        }
      });
      const visibleRequirements = [...requirementsByPosition.values()];
      if (!visibleRequirements.length && !hasTeamSlot(schedule.teamId, [saved.occurrenceId]) && !hasTeamStoredData) return;
      occurrences.push({ ...saved, positionRequirements: visibleRequirements });
      requirementsByOccurrence.set(saved.occurrenceId, visibleRequirements);
      (saved.serviceIds?.length ? saved.serviceIds : [saved.serviceId])
        .forEach((serviceId) => serviceIds.add(serviceId));
    });
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
  const generatedFutureAll = generateScheduleOccurrences({
    services: services.filter((service) => !service.archivedAt),
    serviceIds: services.filter((service) => !service.archivedAt).map((service) => service.serviceId),
    startDate: scanStart,
    endDate: searchEnd,
    timeZone,
  });
  const generatedFuture = generatedFutureAll.flatMap((occurrence) => {
    const occurrenceServiceIds = occurrence.serviceIds?.length
      ? occurrence.serviceIds
      : [occurrence.serviceId];
    const hasTeamRequirement = occurrenceServiceIds.some((serviceId) =>
      sanitizePositionRequirements(services.find((service) => service.serviceId === serviceId)?.positionRequirements)
        .some((requirement) => teamPositionIds.has(requirement.positionId)),
    );
    const matchingSaved = schedules
      .filter((schedule) => !schedule.archivedAt && schedule.teamId === teamId)
      .flatMap((schedule) => (schedule.occurrences || []).map((saved) => ({ schedule, saved })))
      .filter(({ saved }) => matchOccurrencesByIdentity([saved], [occurrence], timeZone)
        .matches.has(occurrence.occurrenceId));
    const hasTeamSlot = matchingSaved.some(({ schedule, saved }) => {
      const slots = "additionalPositionSlots" in schedule
        ? schedule.additionalPositionSlots?.[saved.occurrenceId] || []
        : [];
      return slots.some((slotKey: string) => {
        const slot = parseSlotKey(slotKey);
        return Boolean(slot && teamPositionIds.has(slot.positionId));
      });
    }) || (additionalPositionSlots && (
      additionalPositionSlots[occurrence.occurrenceId] || []
    ).some((slotKey) => {
      const slot = parseSlotKey(slotKey);
      return Boolean(slot && teamPositionIds.has(slot.positionId));
    }));
    if (!hasTeamRequirement && !hasTeamSlot) return [];
    const uniqueSavedMatch = matchingSaved.length === 1 ? matchingSaved[0].saved : null;
    return [{
      ...occurrence,
      ...(uniqueSavedMatch ? { occurrenceId: uniqueSavedMatch.occurrenceId } : {}),
    }];
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
    ? parsePlainDate(getOccurrenceDate(nextOccurrence, timeZone))
    : null;
  const range = calendarMonthRange(nextDate || today);
  const period = buildTeamSchedulePeriod({
    services,
    positions,
    teamId,
    startDate: range.start,
    endDate: range.end,
    additionalPositionSlots,
    schedules,
    timeZone,
  });
  if (
    nextOccurrence &&
    calendarDateInTimeZone(new Date(nextOccurrence.startsAt), timeZone) !== getOccurrenceDate(nextOccurrence, timeZone) &&
    !period.occurrences.some((occurrence) => matchOccurrencesByIdentity([occurrence], [nextOccurrence], timeZone)
      .matches.has(nextOccurrence.occurrenceId))
  ) {
    const occurrenceDate = calendarDateInTimeZone(new Date(nextOccurrence.startsAt), timeZone);
    if (occurrenceDate >= range.start && occurrenceDate <= range.end) {
      const requirementsByPosition = new Map<string, PositionRequirement>();
      (nextOccurrence.serviceIds?.length ? nextOccurrence.serviceIds : [nextOccurrence.serviceId])
        .forEach((serviceId) => resolveOccurrenceRequirements({
          occurrence: nextOccurrence,
          service: services.find((item) => item.serviceId === serviceId),
          teamPositionIds: [...teamPositionIds],
          fallbackToAllTeamPositions: false,
        }).forEach((requirement) => {
          const current = requirementsByPosition.get(requirement.positionId);
          if (!current || current.count < requirement.count) requirementsByPosition.set(requirement.positionId, requirement);
        }));
      const requirements = [...requirementsByPosition.values()];
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
