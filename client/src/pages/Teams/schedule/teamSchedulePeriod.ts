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
  resolveOccurrenceIdentity,
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
  /** Service members that actually contribute staffing needs for this team. */
  serviceIdsByOccurrence: Map<string, string[]>;
};

type ResolvedOccurrenceIdentity = NonNullable<ReturnType<typeof resolveOccurrenceIdentity>>;
type IndexedScheduleOccurrence = {
  occurrence: TeamScheduleOccurrence;
  identity: ResolvedOccurrenceIdentity;
};
type ScheduleOccurrenceIdentityIndex = {
  byLogicalId: Map<string, IndexedScheduleOccurrence[]>;
  byOccurrenceId: Map<string, TeamScheduleOccurrence[]>;
  byDateAndServiceId: Set<string>;
  byNameAndInstant: Set<string>;
};

const dateAndServiceKey = (date: string, serviceId: string) =>
  JSON.stringify([date, serviceId]);

const nameAndInstantKey = (occurrence: TeamScheduleOccurrence) => {
  const name = String(occurrence.name || "").trim().toLocaleLowerCase("en-US");
  const startsAt = Date.parse(String(occurrence.startsAt || ""));
  return name && Number.isFinite(startsAt) ? JSON.stringify([name, startsAt]) : null;
};

const createScheduleOccurrenceIdentityIndex = (): ScheduleOccurrenceIdentityIndex => ({
  byLogicalId: new Map(),
  byOccurrenceId: new Map(),
  byDateAndServiceId: new Set(),
  byNameAndInstant: new Set(),
});

const indexScheduleOccurrence = (
  index: ScheduleOccurrenceIdentityIndex,
  occurrence: TeamScheduleOccurrence,
  timeZone: string,
) => {
  const occurrenceId = String(occurrence.occurrenceId || "");
  const sameIdRows = index.byOccurrenceId.get(occurrenceId) || [];
  sameIdRows.push(occurrence);
  index.byOccurrenceId.set(occurrenceId, sameIdRows);

  const nameAndInstant = nameAndInstantKey(occurrence);
  if (nameAndInstant) index.byNameAndInstant.add(nameAndInstant);

  const identity = resolveOccurrenceIdentity(occurrence, timeZone);
  if (!identity) return;
  const sameLogicalIdRows = index.byLogicalId.get(identity.logicalOccurrenceId) || [];
  sameLogicalIdRows.push({ occurrence, identity });
  index.byLogicalId.set(identity.logicalOccurrenceId, sameLogicalIdRows);
  identity.serviceIds.forEach((serviceId) => {
    index.byDateAndServiceId.add(dateAndServiceKey(identity.serviceDate, serviceId));
  });
};

const sameOccurrenceMembership = (
  left: ResolvedOccurrenceIdentity,
  right: ResolvedOccurrenceIdentity,
) => left.groupId === right.groupId &&
  left.serviceIds.length === right.serviceIds.length &&
  left.serviceIds.every((serviceId, index) => serviceId === right.serviceIds[index]);

const findIndexedOccurrenceMatch = (
  index: ScheduleOccurrenceIdentityIndex,
  occurrence: TeamScheduleOccurrence,
  identity: ResolvedOccurrenceIdentity | null,
) => {
  if (!identity) return { saved: null, ambiguous: true };
  const sameKeyRows = index.byLogicalId.get(identity.logicalOccurrenceId) || [];
  if (sameKeyRows.length > 1) return { saved: null, ambiguous: true };
  if (sameKeyRows.length === 1) {
    const saved = sameKeyRows[0];
    return sameOccurrenceMembership(saved.identity, identity)
      ? { saved: saved.occurrence, ambiguous: false }
      : { saved: null, ambiguous: true };
  }

  const nameAndInstant = nameAndInstantKey(occurrence);
  const possibleConflict = identity.serviceIds.some((serviceId) =>
    index.byDateAndServiceId.has(dateAndServiceKey(identity.serviceDate, serviceId)),
  ) || Boolean(nameAndInstant && index.byNameAndInstant.has(nameAndInstant));
  return { saved: null, ambiguous: possibleConflict };
};

const occurrenceIdentityKey = (identity: ResolvedOccurrenceIdentity) =>
  JSON.stringify([
    identity.logicalOccurrenceId,
    identity.groupId,
    identity.serviceIds,
  ]);

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
  const occurrenceIdentityIndexByTeam = new Map<string, ScheduleOccurrenceIdentityIndex>();
  const matchedStoredIdsByTeam = new Map<string, Set<string>>();
  selectedTeamIds.forEach((selectedTeamId) => {
    occurrenceIdentityIndexByTeam.set(selectedTeamId, createScheduleOccurrenceIdentityIndex());
    matchedStoredIdsByTeam.set(selectedTeamId, new Set());
  });
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
    const identityIndex = occurrenceIdentityIndexByTeam.get(scheduleTeamId);
    if (identityIndex) occurrences.forEach((occurrence) =>
      indexScheduleOccurrence(identityIndex, occurrence, timeZone || "UTC"),
    );
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
  const serviceIdsByOccurrence = new Map<string, string[]>();
  const serviceIds = new Set<string>();

  generated.forEach((occurrence) => {
    const occurrenceServiceIds = occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId];
    const occurrenceIdentity = resolveOccurrenceIdentity(occurrence, timeZone);
    const matchedSavedOccurrenceIds = new Set<string>();
    let hasAmbiguousPersistedKeyCollision = false;
    const requirementsByPosition = new Map<string, PositionRequirement>();
    let relevant = false;
    const relevantServiceIds = new Set<string>();
    selectedTeamIds.forEach((selectedTeamId) => {
      const teamPositionIdsForSchedule = [...(positionIdsByTeam.get(selectedTeamId) || [])];
      const identityIndex = occurrenceIdentityIndexByTeam.get(selectedTeamId);
      const identityMatch = identityIndex
        ? findIndexedOccurrenceMatch(identityIndex, occurrence, occurrenceIdentity)
        : { saved: null, ambiguous: false };
      const savedMatch = identityMatch.saved;
      if (!savedMatch && identityMatch.ambiguous &&
          identityIndex?.byOccurrenceId.has(String(occurrence.occurrenceId || ""))) {
        hasAmbiguousPersistedKeyCollision = true;
      }
      if (savedMatch) {
        matchedSavedOccurrenceIds.add(savedMatch.occurrenceId);
        matchedStoredIdsByTeam.get(selectedTeamId)?.add(String(savedMatch.occurrenceId || ""));
      }
      const teamRequirements = new Map<string, PositionRequirement>();
      occurrenceServiceIds.forEach((serviceId) => {
        const service = allServiceById.get(serviceId);
        const memberDefaultRequirements = resolveOccurrenceRequirements({
          service,
          teamPositionIds: teamPositionIdsForSchedule,
          fallbackToAllTeamPositions: false,
        });
        const serviceRequirements = resolveOccurrenceRequirements({
          // Generated combined occurrences carry the union of every member's
          // requirements. Resolve each member from its own service defaults;
          // only a saved occurrence override applies across the whole group.
          occurrence: savedMatch,
          service,
          teamPositionIds: teamPositionIdsForSchedule,
          fallbackToAllTeamPositions: false,
        });
        // A saved grouped override is an occurrence-wide staffing pool. Use
        // each member's own defaults to attribute that pool to the team's
        // service members instead of treating the override as repeated on
        // every constituent service.
        const membershipRequirements = savedMatch && occurrenceServiceIds.length > 1
          ? memberDefaultRequirements
          : serviceRequirements;
        if (membershipRequirements.length) relevantServiceIds.add(serviceId);
        serviceRequirements.forEach((requirement) => {
          const current = teamRequirements.get(requirement.positionId);
          if (!current || current.count < requirement.count) teamRequirements.set(requirement.positionId, requirement);
        });
      });
      const hasExplicitTeamSlot = hasTeamSlot(selectedTeamId, [
        occurrence.occurrenceId,
        ...(savedMatch ? [savedMatch.occurrenceId] : []),
      ]) || hasStoredLegacySlotForOccurrence(selectedTeamId, occurrence);
      if (!teamRequirements.size && !hasExplicitTeamSlot) return;
      if ((hasExplicitTeamSlot || (savedMatch && teamRequirements.size > 0)) && !relevantServiceIds.size) {
        relevantServiceIds.add(occurrence.serviceId);
      }
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
    serviceIdsByOccurrence.set(displayOccurrence.occurrenceId, [...relevantServiceIds]);
    occurrenceServiceIds.forEach((serviceId) => serviceIds.add(serviceId));
  });

  // Keep unmatched persisted rows in the period so their existing assignment
  // and equipment map keys remain visible while a caller surfaces ambiguity.
  const visibleOccurrenceIds = new Set(occurrences.map((occurrence) => occurrence.occurrenceId));
  selectedSchedules.forEach((schedule) => {
    const teamPositionIds = positionIdsByTeam.get(schedule.teamId) || new Set<string>();
    const safelyMatchedIds = matchedStoredIdsByTeam.get(schedule.teamId) || new Set<string>();
    (schedule.occurrences || []).forEach((saved) => {
      if (safelyMatchedIds.has(saved.occurrenceId) ||
          visibleOccurrenceIds.has(saved.occurrenceId)) return;
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
      visibleOccurrenceIds.add(saved.occurrenceId);
      requirementsByOccurrence.set(saved.occurrenceId, visibleRequirements);
      const savedServiceIds = (saved.serviceIds?.length ? saved.serviceIds : [saved.serviceId])
        .filter((serviceId) => resolveOccurrenceRequirements({
          occurrence: saved,
          service: allServiceById.get(serviceId),
          teamPositionIds: [...teamPositionIds],
          fallbackToAllTeamPositions: false,
        }).length > 0);
      serviceIdsByOccurrence.set(saved.occurrenceId, savedServiceIds.length ? savedServiceIds : [saved.serviceId]);
      (saved.serviceIds?.length ? saved.serviceIds : [saved.serviceId])
        .forEach((serviceId) => serviceIds.add(serviceId));
    });
  });

  return {
    occurrences,
    allOccurrences: generated,
    serviceIds: [...serviceIds],
    requirementsByOccurrence,
    serviceIdsByOccurrence,
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
  const teamSchedules = schedules.filter((schedule) =>
    !schedule.archivedAt && schedule.teamId === teamId,
  );
  const savedOccurrencesByIdentity = new Map<string, Array<{
    schedule: TeamSchedule | TeamScheduleSummary;
    saved: TeamScheduleOccurrence;
  }>>();
  teamSchedules.forEach((schedule) => {
    (schedule.occurrences || []).forEach((saved) => {
      const identity = resolveOccurrenceIdentity(saved, timeZone);
      if (!identity) return;
      const key = occurrenceIdentityKey(identity);
      const matches = savedOccurrencesByIdentity.get(key) || [];
      matches.push({ schedule, saved });
      savedOccurrencesByIdentity.set(key, matches);
    });
  });
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
  const activeServices = services.filter((service) => !service.archivedAt);
  const hasTeamRequirementByServiceId = new Map<string, boolean>();
  services.forEach((service) => {
    if (hasTeamRequirementByServiceId.has(service.serviceId)) return;
    hasTeamRequirementByServiceId.set(
      service.serviceId,
      sanitizePositionRequirements(service.positionRequirements).some((requirement) =>
        teamPositionIds.has(requirement.positionId),
      ),
    );
  });
  const generatedFutureAll = generateScheduleOccurrences({
    services: activeServices,
    serviceIds: activeServices.map((service) => service.serviceId),
    startDate: scanStart,
    endDate: searchEnd,
    timeZone,
  });
  const generatedFuture = generatedFutureAll.flatMap((occurrence) => {
    const occurrenceServiceIds = occurrence.serviceIds?.length
      ? occurrence.serviceIds
      : [occurrence.serviceId];
    const hasTeamRequirement = occurrenceServiceIds.some((serviceId) =>
      hasTeamRequirementByServiceId.get(serviceId) || false,
    );
    const occurrenceIdentity = resolveOccurrenceIdentity(occurrence, timeZone);
    const matchingSaved = occurrenceIdentity
      ? savedOccurrencesByIdentity.get(occurrenceIdentityKey(occurrenceIdentity)) || []
      : [];
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
  const savedFuture = teamSchedules
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
