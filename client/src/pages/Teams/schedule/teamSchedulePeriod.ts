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
import { rangeFromPreset } from "./schedulePeriodUtils";

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

/** Pick an upcoming window that starts today and includes the next team occurrence. */
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
  preset: "upcoming";
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
    const { start, end } = rangeFromPreset("upcoming", today);
    return {
      start,
      end,
      preset: "upcoming",
      period: { occurrences: [], allOccurrences: [], serviceIds: [], requirementsByOccurrence: new Map() },
      nextOccurrence: null,
    };
  }
  const scanEnd = new Date(today.getFullYear() + 2, today.getMonth(), today.getDate());
  services.forEach((service) => {
    [service.dateTimeISO, service.startDateISO, service.endDateISO].forEach((value) => {
      if (!value) return;
      const date = parsePlainDate(value.slice(0, 10));
      if (date && date > scanEnd) scanEnd.setTime(date.getTime());
    });
  });
  const todayPlainDate = formatPlainDate(today);
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
  let target = today;
  let nextOccurrence: TeamScheduleOccurrence | null = null;
  for (const cursor = new Date(today.getFullYear(), today.getMonth(), 1); cursor <= scanEnd; cursor.setMonth(cursor.getMonth() + 1)) {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const monthStartDate = formatPlainDate(start);
    const monthEndDate = formatPlainDate(monthEnd);
    const period = buildTeamSchedulePeriod({
      services,
      positions,
      teamId,
      startDate: monthStartDate,
      endDate: monthEndDate,
      additionalPositionSlots,
    });
    const next = period.occurrences.find((occurrence) => getOccurrenceDate(occurrence) >= todayPlainDate);
    if (next) {
      nextOccurrence = next;
      target = parsePlainDate(getOccurrenceDate(next)) || today;
      break;
    }
  }
  const defaultRange = rangeFromPreset("upcoming", today);
  const periodEnd = nextOccurrence
    ? formatPlainDate(new Date(target.getFullYear(), target.getMonth() + 1, 0))
    : defaultRange.end;
  const startDate = todayPlainDate;
  return {
    start: startDate,
    end: periodEnd,
    preset: "upcoming",
    period: buildTeamSchedulePeriod({
      services,
      positions,
      teamId,
      startDate,
      endDate: periodEnd,
      additionalPositionSlots,
    }),
    nextOccurrence,
  };
};
