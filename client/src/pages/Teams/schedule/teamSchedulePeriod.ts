import type {
  PositionRequirement,
  TeamPosition,
  TeamScheduleOccurrence,
  TeamSchedule,
  TeamScheduleSummary,
  TeamService,
} from "../../../api/authTypes";
import { formatPlainDate } from "@/utils/plainDate";
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
  const range = rangeFromPreset("upcoming", today);
  const period = buildTeamSchedulePeriod({
    services,
    positions,
    teamId,
    startDate: range.start,
    endDate: range.end,
    additionalPositionSlots,
  });
  return {
    start: range.start,
    end: range.end,
    preset: "upcoming",
    period,
    nextOccurrence: period.occurrences.find(
      (occurrence) => getOccurrenceDate(occurrence) >= todayPlainDate,
    ) || null,
  };
};
