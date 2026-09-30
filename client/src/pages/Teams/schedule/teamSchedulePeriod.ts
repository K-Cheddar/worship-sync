import type {
  PositionRequirement,
  TeamPosition,
  TeamScheduleOccurrence,
  TeamSchedule,
  TeamScheduleSummary,
  TeamService,
} from "../../../api/authTypes";
import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";
import { generateScheduleOccurrences, getOccurrenceDate } from "@/utils/teamScheduleOccurrences";
import { parseSlotKey, resolveOccurrenceRequirements } from "./scheduleRequirements";
import { isHydratedSchedule } from "../../../api/authTypes";

export type TeamSchedulePeriod = {
  occurrences: TeamScheduleOccurrence[];
  /** Full generated set supports legacy matching without rendering unrelated rows. */
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
  const serviceById = new Map(services.map((service) => [service.serviceId, service]));
  const teamPositionIds = positions
    .filter((position) => position.teamId === teamId)
    .map((position) => position.positionId);
  const teamPositionIdSet = new Set(teamPositionIds);
  const generated = generateScheduleOccurrences({
    services,
    serviceIds: services.map((service) => service.serviceId),
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

/** Pick the calendar month containing the first relevant occurrence on/after today. */
export const findInitialTeamSchedulePeriod = ({
  services,
  positions,
  teamId,
  schedules = [],
  now = new Date(),
}: {
  services: TeamService[];
  positions: TeamPosition[];
  teamId: string;
  schedules?: Array<TeamSchedule | TeamScheduleSummary>;
  now?: Date;
}): {
  start: string;
  end: string;
  preset: "thisMonth" | "nextMonth" | "custom";
  period: TeamSchedulePeriod;
  nextOccurrence: TeamScheduleOccurrence | null;
} => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const teamPositionIds = positions
    .filter((position) => position.teamId === teamId)
    .map((position) => position.positionId);
  const hasConfiguredTeamNeed = services.some((service) =>
    resolveOccurrenceRequirements({
      service,
      teamPositionIds,
      fallbackToAllTeamPositions: false,
    }).length > 0,
  );
  const hasExistingTeamSlot = schedules.some((schedule) =>
    schedule.teamId === teamId &&
    !schedule.archivedAt &&
    isHydratedSchedule(schedule) &&
    Object.values(schedule.additionalPositionSlots || {}).some((keys) =>
      keys.some((key) => {
        const slot = parseSlotKey(key);
        return Boolean(slot && teamPositionIds.includes(slot.positionId));
      }),
    ),
  );
  if (!hasConfiguredTeamNeed && !hasExistingTeamSlot) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const startDate = formatPlainDate(start);
    const endDate = formatPlainDate(monthEnd);
    return {
      start: startDate,
      end: endDate,
      preset: "thisMonth",
      period: { occurrences: [], allOccurrences: [], serviceIds: [], requirementsByOccurrence: new Map() },
      nextOccurrence: null,
    };
  }
  const end = new Date(today.getFullYear() + 2, today.getMonth(), today.getDate());
  services.forEach((service) => {
    [service.dateTimeISO, service.startDateISO, service.endDateISO].forEach((value) => {
      if (!value) return;
      const date = parsePlainDate(value.slice(0, 10));
      if (date && date > end) end.setTime(date.getTime());
    });
  });
  const todayPlainDate = formatPlainDate(today);
  let target = today;
  let initialPeriod: TeamSchedulePeriod | null = null;
  let nextOccurrence: TeamScheduleOccurrence | null = null;
  for (const cursor = new Date(today.getFullYear(), today.getMonth(), 1); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const monthStartDate = formatPlainDate(start);
    const monthEndDate = formatPlainDate(monthEnd);
    const additionalPositionSlots = schedules
      .filter((schedule) =>
        !schedule.archivedAt &&
        schedule.teamId === teamId &&
        isHydratedSchedule(schedule) &&
        schedule.startDate === monthStartDate &&
        schedule.endDate === monthEndDate,
      )
      .reduce<Record<string, string[]>>((slots, schedule) => {
        if (!isHydratedSchedule(schedule)) return slots;
        Object.entries(schedule.additionalPositionSlots || {}).forEach(([occurrenceId, keys]) => {
          slots[occurrenceId] = [...(slots[occurrenceId] || []), ...keys];
        });
        return slots;
      }, {});
    const period = buildTeamSchedulePeriod({
      services,
      positions,
      teamId,
      startDate: monthStartDate,
      endDate: monthEndDate,
      additionalPositionSlots,
    });
    if (!initialPeriod) initialPeriod = period;
    const next = period.occurrences.find((occurrence) => getOccurrenceDate(occurrence) >= todayPlainDate);
    if (next) {
      nextOccurrence = next;
      target = parsePlainDate(getOccurrenceDate(next)) || today;
      initialPeriod = period;
      break;
    }
  }
  const start = new Date(target.getFullYear(), target.getMonth(), 1);
  const monthEnd = new Date(target.getFullYear(), target.getMonth() + 1, 0);
  const monthOffset = (start.getFullYear() - today.getFullYear()) * 12 + start.getMonth() - today.getMonth();
  return {
    start: formatPlainDate(start),
    end: formatPlainDate(monthEnd),
    preset: monthOffset === 0 ? "thisMonth" : monthOffset === 1 ? "nextMonth" : "custom",
    period: initialPeriod || buildTeamSchedulePeriod({
      services,
      positions,
      teamId,
      startDate: formatPlainDate(start),
      endDate: formatPlainDate(monthEnd),
    }),
    nextOccurrence,
  };
};
