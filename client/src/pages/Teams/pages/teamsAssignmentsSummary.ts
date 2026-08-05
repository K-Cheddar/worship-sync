import type {
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleOccurrence,
  TeamScheduleSummary,
  TeamService,
} from "../../../api/authTypes";
import { isHydratedSchedule } from "../../../api/authTypes";
import { getOccurrenceDate } from "../../../utils/teamScheduleOccurrences";
import {
  buildScheduleColumns,
  getRequiredCount,
  makeSlotKey,
  parseSlotKey,
  resolveOccurrenceRequirements,
  sanitizePositionRequirements,
} from "../schedule/scheduleRequirements";
import { sortPositionsByOrder } from "../teamsUtils";

export type TeamsAssignmentSummaryRow = {
  teamId: string;
  teamName: string;
  /**
   * Schedule that owns this slot — the deep-link target. null for a position the
   * service requires on a team that has no schedule covering this date, so there
   * is no grid to open yet.
   */
  scheduleId: string | null;
  /**
   * The *schedule's* occurrence id, which is what its assignments are keyed by.
   * Can differ from the plan occurrence's id when the schedule has drifted (see
   * `findScheduleOccurrenceId`), so always use this to focus a cell.
   */
  occurrenceId: string;
  positionId: string;
  positionName: string;
  /** Grid cell key (`positionId::slot`), for focusing the slot on arrival. */
  columnKey: string;
  /** Position name, suffixed with the slot number when a position has several. */
  slotLabel: string;
  /** null when the slot is required but nobody is assigned yet. */
  memberName: string | null;
  /** Church microphones allocated to this scheduled slot for the day. */
  microphoneIds: string[];
};

export type TeamsAssignmentSummaryTeamGroup = {
  teamId: string;
  teamName: string;
  /** null when this team has no schedule covering the date — see the row type. */
  scheduleId: string | null;
  /**
   * Set only when the same team appears more than once for this occurrence, so
   * the panel can say *which* schedule each block came from. Two identical
   * "MEDIA" headings are otherwise indistinguishable.
   */
  scheduleName?: string;
  occurrenceId: string;
  /** Rows with someone assigned, listed in the panel. */
  filled: TeamsAssignmentSummaryRow[];
  /** Required-but-empty slots, collapsed behind a count in the panel. */
  unfilled: TeamsAssignmentSummaryRow[];
};

/**
 * Which of a schedule's own occurrences corresponds to this plan occurrence.
 *
 * Exact id first. A saved schedule keeps its stored occurrence shape, so its ids
 * drift from freshly generated ones whenever the service definition changes
 * (see `occurrenceIdsMatch` and the re-sync flow in ScheduleTab) — without the
 * date+service fallback a drifted schedule would report *every* slot unfilled,
 * which reads far worse than the old filled-only panel's silence.
 */
const findScheduleOccurrenceId = (
  schedule: TeamSchedule | TeamScheduleSummary,
  occurrence: TeamScheduleOccurrence,
): string | null => {
  const stored = schedule.occurrences || [];
  if (stored.some((item) => item.occurrenceId === occurrence.occurrenceId)) {
    return occurrence.occurrenceId;
  }
  // Legacy/lean schedules can carry assignments without stored occurrences.
  if (
    isHydratedSchedule(schedule) &&
    schedule.assignments?.[occurrence.occurrenceId]
  ) {
    return occurrence.occurrenceId;
  }
  const wantedServiceIds = new Set(
    occurrence.serviceIds?.length
      ? occurrence.serviceIds
      : [occurrence.serviceId],
  );
  const wantedDate = getOccurrenceDate(occurrence);
  const match = stored.find((item) => {
    if (getOccurrenceDate(item) !== wantedDate) return false;
    const itemServiceIds = item.serviceIds?.length
      ? item.serviceIds
      : [item.serviceId];
    return itemServiceIds.some((serviceId) => wantedServiceIds.has(serviceId));
  });
  return match?.occurrenceId ?? null;
};

/**
 * Schedules that cover this occurrence but arrived from the bootstrap as
 * summaries, so their assignment maps are not on the client yet.
 *
 * The bootstrap only hydrates schedules around today. Filtering those summaries
 * out (`onlyHydratedSchedules`) and rendering what's left is indistinguishable
 * from "nobody is scheduled" — a plan a few months out reads as an empty roster
 * rather than as data we simply haven't fetched. Callers use this to fetch the
 * detail, and to say so plainly until it lands.
 */
export const getUnhydratedOccurrenceScheduleIds = (
  occurrence: TeamScheduleOccurrence,
  schedules: (TeamSchedule | TeamScheduleSummary)[],
): string[] =>
  schedules
    .filter(
      (schedule) =>
        !isHydratedSchedule(schedule) &&
        !schedule.archivedAt &&
        findScheduleOccurrenceId(schedule, occurrence) !== null,
    )
    .map((schedule) => schedule.scheduleId);

/**
 * What this occurrence's own service says it needs, independent of any schedule:
 * a combined occurrence carries the merged requirements of its grouped services,
 * otherwise the service's own defaults apply.
 *
 * Deliberately *not* `resolveOccurrenceRequirements` — that falls back to "every
 * team position, one slot each" when nothing is configured, which is right for a
 * schedule scoped to one team but would list every position in the church here.
 */
const getServiceRequirements = (
  occurrence: TeamScheduleOccurrence,
  services: TeamService[],
) => {
  const fromOccurrence = sanitizePositionRequirements(
    occurrence.positionRequirements,
  );
  if (fromOccurrence.length) return fromOccurrence;
  const service = services.find(
    (item) => item.serviceId === occurrence.serviceId,
  );
  return sanitizePositionRequirements(service?.positionRequirements);
};

/**
 * Read-only "who's serving" for one occurrence, for showing next to the
 * order-of-service editor. Returns one row per *required* slot (filled or not)
 * across every schedule covering this occurrence, plus any filled cell that no
 * longer matches a requirement, so lowering a position's count never hides a
 * person who is still assigned.
 *
 * Archived schedules contribute their filled rows only: they still record who
 * served, but their requirements are retired and would otherwise pad the
 * unfilled count with slots nobody intends to fill.
 *
 * Any team the service requires positions from but that has no schedule covering
 * this date still gets its slots listed, sourced from the service's own required
 * positions and flagged with a null scheduleId — the plan should answer "what
 * does this service need" before anyone has built a schedule for it.
 */
export const getOccurrenceAssignmentSummary = ({
  occurrence,
  schedules,
  positions,
  members,
  teams,
  services,
}: {
  occurrence: TeamScheduleOccurrence;
  schedules: TeamSchedule[];
  positions: TeamPosition[];
  members: TeamRosterMember[];
  teams: TeamRecord[];
  services: TeamService[];
}): TeamsAssignmentSummaryRow[] => {
  const positionById = new Map(
    positions.map((position) => [position.positionId, position]),
  );
  const memberById = new Map(
    members.map((member) => [member.memberId, member]),
  );
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const rows: TeamsAssignmentSummaryRow[] = [];
  const scheduledTeamIds = new Set<string>();

  for (const schedule of schedules) {
    const scheduleOccurrenceId = findScheduleOccurrenceId(schedule, occurrence);
    if (!scheduleOccurrenceId) continue;
    scheduledTeamIds.add(schedule.teamId);
    const cells = schedule.assignments?.[scheduleOccurrenceId];
    const isArchived = Boolean(schedule.archivedAt);
    if (isArchived && !cells) continue;

    const memberNameFor = (memberId?: string) => {
      if (!memberId) return null;
      const member = memberById.get(memberId);
      if (!member) return null;
      return `${member.firstName} ${member.lastName}`.trim();
    };
    const rowFor = ({
      positionId,
      columnKey,
      slotLabel,
      memberName,
      microphoneIds,
    }: {
      positionId: string;
      columnKey: string;
      slotLabel: string;
      memberName: string | null;
      microphoneIds: string[];
    }): TeamsAssignmentSummaryRow => {
      const position = positionById.get(positionId);
      const teamId = position?.teamId || schedule.teamId || "unknown";
      return {
        teamId,
        teamName: teamById.get(teamId)?.name || "Team",
        scheduleId: schedule.scheduleId,
        occurrenceId: scheduleOccurrenceId,
        positionId,
        positionName: position?.name || "Position",
        columnKey,
        slotLabel,
        memberName,
        microphoneIds,
      };
    };

    const covered = new Set<string>();
    if (!isArchived) {
      const teamPositionIds = sortPositionsByOrder(
        positions.filter((position) => position.teamId === schedule.teamId),
      ).map((position) => position.positionId);
      // Requirements can be overridden per occurrence, so prefer the schedule's
      // own stored occurrence over the freshly generated plan one.
      const storedOccurrence =
        schedule.occurrences?.find(
          (item) => item.occurrenceId === scheduleOccurrenceId,
        ) || occurrence;
      const service = services.find(
        (item) => item.serviceId === storedOccurrence.serviceId,
      );
      const requirements = resolveOccurrenceRequirements({
        occurrence: storedOccurrence,
        service,
        teamPositionIds,
      });
      const columns = buildScheduleColumns({
        occurrences: [{ occurrenceId: scheduleOccurrenceId }],
        requirementsByOccurrence: new Map([
          [scheduleOccurrenceId, requirements],
        ]),
        additionalPositionSlots: schedule.additionalPositionSlots,
        positions,
        teamPositionIds,
      });
      const additionalSlotKeys = new Set(
        schedule.additionalPositionSlots?.[scheduleOccurrenceId] || [],
      );
      for (const column of columns) {
        // Same guard the grid and board render with: core slots plus roles
        // explicitly added for this date.
        const isRequired =
          column.slot < getRequiredCount(requirements, column.positionId);
        if (!isRequired && !additionalSlotKeys.has(column.columnKey)) continue;
        covered.add(column.columnKey);
        rows.push(
          rowFor({
            positionId: column.positionId,
            columnKey: column.columnKey,
            slotLabel: column.label,
            memberName: memberNameFor(
              cells?.[column.columnKey]?.primaryMemberId,
            ),
            microphoneIds:
              schedule.microphoneAssignments?.[scheduleOccurrenceId]?.[
                column.columnKey
              ] || [],
          }),
        );
      }
    }

    // Assignments outside the current requirements (count lowered after someone
    // was scheduled, or a position moved teams) still describe a real person on
    // the platform this weekend — never drop them.
    for (const [slotKey, cell] of Object.entries(cells || {})) {
      if (covered.has(slotKey)) continue;
      const parsed = parseSlotKey(slotKey);
      if (!parsed) continue;
      const memberName = memberNameFor(cell.primaryMemberId);
      if (!memberName) continue;
      const position = positionById.get(parsed.positionId);
      rows.push(
        rowFor({
          positionId: parsed.positionId,
          columnKey: slotKey,
          slotLabel: position?.name || "Position",
          memberName,
          microphoneIds:
            schedule.microphoneAssignments?.[scheduleOccurrenceId]?.[slotKey] ||
            [],
        }),
      );
    }
  }

  // Teams the service needs but nobody has scheduled for this date yet.
  const serviceRequirements = getServiceRequirements(occurrence, services);
  const requiredCountByPosition = new Map(
    serviceRequirements.map((req) => [req.positionId, req.count]),
  );
  const unscheduledPositions = sortPositionsByOrder(
    positions.filter(
      (position) =>
        requiredCountByPosition.has(position.positionId) &&
        !scheduledTeamIds.has(position.teamId),
    ),
  );
  for (const position of unscheduledPositions) {
    const required = requiredCountByPosition.get(position.positionId) ?? 0;
    for (let slot = 0; slot < required; slot += 1) {
      rows.push({
        teamId: position.teamId,
        teamName: teamById.get(position.teamId)?.name || "Team",
        scheduleId: null,
        occurrenceId: occurrence.occurrenceId,
        positionId: position.positionId,
        positionName: position.name,
        columnKey: makeSlotKey(position.positionId, slot),
        slotLabel:
          required > 1 ? `${position.name} ${slot + 1}` : position.name,
        memberName: null,
        microphoneIds: [],
      });
    }
  }

  return rows;
};

/**
 * Identifies one scheduled slot's microphone allocation across the surfaces
 * that save it — used to show a save in progress on that slot alone.
 */
export const teamMicrophoneSlotKey = (row: TeamsAssignmentSummaryRow) =>
  `${row.scheduleId}:${row.occurrenceId}:${row.columnKey}`;

/**
 * The rows that can hold a church microphone for the day: scheduled slots on
 * teams that opted into microphone assignments. A row with no schedule has no
 * cell to write to, so it can never carry one.
 */
export const getTeamMicrophoneRows = (
  rows: TeamsAssignmentSummaryRow[],
  teams: TeamRecord[],
): TeamsAssignmentSummaryRow[] => {
  const microphoneTeamIds = new Set(
    teams
      .filter((team) => team.usesMicrophoneAssignments)
      .map((team) => team.teamId),
  );
  return rows.filter(
    (row) => row.scheduleId && microphoneTeamIds.has(row.teamId),
  );
};

/**
 * Who each microphone is already allocated to by the schedule, keyed by
 * microphone id — what the plan's own per-item microphone picker warns with
 * before an operator hands the same microphone to someone else.
 */
export const getScheduledMicrophoneHolders = (
  rows: TeamsAssignmentSummaryRow[],
  teams: TeamRecord[],
): Map<string, string[]> => {
  const holdersByMicrophone = new Map<string, string[]>();
  getTeamMicrophoneRows(rows, teams).forEach((row) => {
    const holder = row.memberName || row.slotLabel;
    row.microphoneIds.forEach((microphoneId) => {
      const holders = holdersByMicrophone.get(microphoneId);
      if (holders) {
        holders.push(holder);
        return;
      }
      holdersByMicrophone.set(microphoneId, [holder]);
    });
  });
  return holdersByMicrophone;
};

export type TeamsAssignmentSummaryNeed = {
  positionId: string;
  positionName: string;
  count: number;
};

/**
 * Collapse slot rows to one entry per position with how many are needed, for
 * teams with no schedule yet — listing "Vocal ×3" beats three identical lines in
 * a sidebar this narrow.
 */
export const summarizeNeededPositions = (
  rows: TeamsAssignmentSummaryRow[],
): TeamsAssignmentSummaryNeed[] => {
  const byPosition = new Map<string, TeamsAssignmentSummaryNeed>();
  for (const row of rows) {
    const existing = byPosition.get(row.positionId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byPosition.set(row.positionId, {
      positionId: row.positionId,
      positionName: row.positionName,
      count: 1,
    });
  }
  return [...byPosition.values()];
};

/**
 * Group slot rows under their team (and schedule, since a team can run more
 * than one schedule over the same date) for the Plans sidebar, splitting filled
 * from unfilled so the panel can stay compact.
 */
export const groupAssignmentSummaryByTeam = (
  rows: TeamsAssignmentSummaryRow[],
  schedules: TeamSchedule[] = [],
): TeamsAssignmentSummaryTeamGroup[] => {
  const groups = new Map<string, TeamsAssignmentSummaryTeamGroup>();
  for (const row of rows) {
    const key = `${row.teamId}::${row.scheduleId ?? ""}`;
    const group = groups.get(key) || {
      teamId: row.teamId,
      teamName: row.teamName,
      scheduleId: row.scheduleId,
      occurrenceId: row.occurrenceId,
      filled: [],
      unfilled: [],
    };
    if (row.memberName) {
      group.filled.push(row);
    } else {
      group.unfilled.push(row);
    }
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    a.teamName.localeCompare(b.teamName),
  );

  // A team can legitimately have several schedules covering one date (or two
  // teams can share a name). Label those blocks with their schedule so the
  // panel doesn't show the same heading twice with different numbers.
  const nameCounts = new Map<string, number>();
  for (const group of ordered) {
    nameCounts.set(group.teamName, (nameCounts.get(group.teamName) || 0) + 1);
  }
  const scheduleNameById = new Map(
    schedules.map((schedule) => [schedule.scheduleId, schedule.name]),
  );
  return ordered.map((group) =>
    (nameCounts.get(group.teamName) || 0) > 1 && group.scheduleId
      ? {
          ...group,
          scheduleName: scheduleNameById.get(group.scheduleId) || undefined,
        }
      : group,
  );
};
