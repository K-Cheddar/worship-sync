import type { TeamPosition, TeamSchedule, TeamScheduleOccurrence, TeamScheduleSummary, TeamService } from "../../../api/authTypes";
import { isHydratedSchedule } from "../../../api/authTypes";
import { getOccurrenceDate, matchOccurrencesByIdentity, resolveOccurrenceIdentity } from "@/utils/teamScheduleOccurrences";
import type { PlainDateRange } from "../rangeSelection";
import { buildTeamSchedulePeriod } from "./teamSchedulePeriod";
import { findScheduleOccurrenceOwnershipConflicts } from "./schedulePeriodUtils";

export type ScheduleWorkspaceOwner = {
  scheduleId: string;
  savedOccurrenceId: string;
} & (
  | { hydrated: true; schedule: TeamSchedule }
  | { hydrated: false; schedule: null }
);

export type ScheduleWorkspaceRow = {
  /** Null means the legacy row cannot be safely assigned a canonical identity. */
  identity: ReturnType<typeof resolveOccurrenceIdentity>;
  occurrence: TeamScheduleOccurrence;
  /** Current service details are separate from the persisted staffing snapshot. */
  generatedOccurrence?: TeamScheduleOccurrence;
  status: "saved" | "virtual" | "ambiguous";
  owner: ScheduleWorkspaceOwner | null;
  reviewScheduleIds: string[];
};

/**
 * Read-only projection, never a schedule document or merged assignment map.
 * Consumers must gate cells on owner.hydrated; null schedule means unknown staffing,
 * not an empty assignment map. Ambiguous rows are review-only, including generated
 * rows whose potential owners cannot be safely reconciled.
 */
export const resolveScheduleWorkspace = ({
  churchId, teamId, range, timeZone, services, positions, schedules,
}: {
  churchId: string;
  teamId: string;
  range: PlainDateRange;
  timeZone: string;
  services: TeamService[];
  positions: TeamPosition[];
  schedules: TeamScheduleSummary[];
}): { rows: ScheduleWorkspaceRow[]; requiredHydrationScheduleIds: string[] } => {
  const owners = schedules.filter((schedule) =>
    !schedule.archivedAt && schedule.churchId === churchId && schedule.teamId === teamId,
  );
  const period = buildTeamSchedulePeriod({
    services: services.filter((service) => service.churchId === churchId),
    positions: positions.filter((position) => position.churchId === churchId),
    teamId, startDate: range.start, endDate: range.end, schedules: owners, timeZone,
  });
  const ownershipCandidates = (occurrence: TeamScheduleOccurrence) =>
    findScheduleOccurrenceOwnershipConflicts({
      schedules: owners, churchId, teamId, occurrences: [occurrence], timeZone,
    });
  const rows: ScheduleWorkspaceRow[] = [];
  const savedRows = new Map<TeamScheduleOccurrence, ScheduleWorkspaceRow>();
  owners.forEach((schedule) => {
    (schedule.occurrences || []).forEach((occurrence) => {
      const date = getOccurrenceDate(occurrence, timeZone);
      if (date ? date < range.start || date > range.end :
        Boolean((schedule.startDate && schedule.startDate > range.end) ||
          (schedule.endDate && schedule.endDate < range.start))) return;
      const identity = resolveOccurrenceIdentity(occurrence, timeZone);
      const candidates = ownershipCandidates(occurrence);
      const ownMatch = matchOccurrencesByIdentity(schedule.occurrences || [], [occurrence], timeZone);
      const ambiguous = !identity || candidates.length > 1 ||
        ownMatch.ambiguousCurrentIds.has(occurrence.occurrenceId);
      const owner: ScheduleWorkspaceOwner = isHydratedSchedule(schedule)
        ? { scheduleId: schedule.scheduleId, savedOccurrenceId: occurrence.occurrenceId, hydrated: true, schedule }
        : { scheduleId: schedule.scheduleId, savedOccurrenceId: occurrence.occurrenceId, hydrated: false, schedule: null };
      const row: ScheduleWorkspaceRow = {
        identity, occurrence, status: ambiguous ? "ambiguous" : "saved", owner,
        reviewScheduleIds: ambiguous ? [...new Set([schedule.scheduleId, ...candidates.map((item) => item.scheduleId)])] : [],
      };
      rows.push(row);
      savedRows.set(occurrence, row);
    });
  });

  // Use complete generated membership for matching, even when saved staffing
  // overrides removed a service from the team's current generated projection.
  period.allOccurrences.forEach((generated) => {
    const candidates = ownershipCandidates(generated);
    const relevant = period.occurrences.some((occurrence) =>
      matchOccurrencesByIdentity([occurrence], [generated], timeZone).matches.has(generated.occurrenceId),
    );
    if (!relevant && !candidates.length) return;
    const matches = candidates.map((schedule) => ({
      schedule,
      match: matchOccurrencesByIdentity(schedule.occurrences || [], [generated], timeZone),
    }));
    const ambiguous = candidates.length > 1 || matches.some(({ match }) =>
      match.ambiguousCurrentIds.has(generated.occurrenceId),
    );
    const reviewScheduleIds = candidates.map((schedule) => schedule.scheduleId);
    matches.forEach(({ schedule }) => {
      // Pairwise matching identifies every preserved row involved in an unsafe
      // group/membership mapping, without inventing another identity rule.
      (schedule.occurrences || []).forEach((saved) => {
        const pair = matchOccurrencesByIdentity([saved], [generated], timeZone);
        if (!pair.matches.size && !pair.ambiguousCurrentIds.size) return;
        const row = savedRows.get(saved);
        if (!row) return;
        if (ambiguous) {
          row.status = "ambiguous";
          row.reviewScheduleIds = [...new Set([...row.reviewScheduleIds, ...reviewScheduleIds])];
        } else {
          row.generatedOccurrence = generated;
        }
      });
    });
    if (candidates.length && !ambiguous) return;
    rows.push({
      identity: resolveOccurrenceIdentity(generated, timeZone), occurrence: generated,
      status: ambiguous ? "ambiguous" : "virtual", owner: null,
      reviewScheduleIds: ambiguous ? reviewScheduleIds : [],
    });
  });
  rows.sort((left, right) => left.occurrence.startsAt.localeCompare(right.occurrence.startsAt) ||
    left.occurrence.occurrenceId.localeCompare(right.occurrence.occurrenceId) ||
    (left.owner?.scheduleId || "").localeCompare(right.owner?.scheduleId || ""));
  const requiredHydrationScheduleIds = [...new Set(rows.flatMap((row) => [
    ...(row.owner && !row.owner.hydrated ? [row.owner.scheduleId] : []),
    ...row.reviewScheduleIds.filter((id) => !isHydratedSchedule(owners.find((owner) => owner.scheduleId === id))),
  ]))].sort();
  return { rows, requiredHydrationScheduleIds };
};
