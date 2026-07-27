import type {
  PositionRequirement,
  TeamPosition,
  TeamQualificationLevel,
  TeamRosterMember,
  TeamScheduleAssignments,
} from "../../../api/authTypes";
import { countScheduleAssignmentsForMember, getCellMemberIds, getCellPrimaryMemberId } from "../teamsUtils";
import { getRequiredCount, type ScheduleSlotColumn } from "./scheduleRequirements";
import {
  buildScheduleMemberPickerMembers,
  computeLevelBalanceBoost,
  type ScheduleMemberRecommendationStats,
} from "./scheduleMemberPickerUtils";

export type AutoFillEntry = {
  occurrenceId: string;
  columnKey: string;
  positionId: string;
  memberId: string;
};

export type AutoFillSlot = {
  occurrenceId: string;
  columnKey: string;
};

export type AutoFillPlan = {
  entries: AutoFillEntry[];
  unfilledSlots: AutoFillSlot[];
};

export type BuildAutoFillPlanArgs = {
  /** Chronological, matches how spacing/distance is interpreted elsewhere. */
  occurrences: { occurrenceId: string }[];
  columns: ScheduleSlotColumn[];
  requirementsByOccurrence: Map<string, PositionRequirement[]>;
  /** The schedule's current (persisted) assignments — never mutated here. */
  assignments: TeamScheduleAssignments | undefined;
  members: TeamRosterMember[];
  positions: TeamPosition[];
  qualificationLevels: TeamQualificationLevel[];
  duplicateFirstNames: Set<string>;
  /** Existing hard-block check (archived / not on team / positionIds / blockout / already assigned per persisted state). */
  getAssignmentIssue: (
    memberId: string,
    occurrenceId: string,
    positionId: string,
  ) => string;
  /**
   * Existing soft warning (e.g. marked unavailable on intake) — soft for the
   * manual picker, but treated as a hard block here (see isBlockedForAutoFill
   * below): auto-fill never surfaces the warning for review, so it must not
   * silently place someone who raised it.
   */
  getServiceAvailabilityWarning: (memberId: string, occurrenceId: string) => string;
  /** Existing cross-team double-booking check. Auto-fill excludes these outright rather than confirming, unlike interactive assignment. */
  getCrossTeamConflictWarning: (memberId: string, occurrenceId: string) => string;
};

/**
 * Fill every empty slot in a schedule using the same recommendation ranking
 * as the manual "Recommended" picker (eligibility, fairness, spacing, level
 * balance, desired position), greedily and occurrence-by-occurrence. Within
 * an occurrence, the scarcest positions (fewest eligible, not-yet-used
 * candidates) are filled first so a rare position doesn't lose its only
 * eligible person to a well-supplied one filled earlier. Slots with no
 * eligible candidate are left empty and reported in `unfilledSlots` for the
 * scheduler to finish by hand — there is no backtracking or swap repair.
 */
export const buildAutoFillPlan = ({
  occurrences,
  columns,
  requirementsByOccurrence,
  assignments,
  members,
  positions,
  qualificationLevels,
  duplicateFirstNames,
  getAssignmentIssue,
  getServiceAvailabilityWarning,
  getCrossTeamConflictWarning,
}: BuildAutoFillPlanArgs): AutoFillPlan => {
  const positionById = new Map(positions.map((position) => [position.positionId, position]));
  const occurrenceIndexById = new Map(
    occurrences.map((occurrence, index) => [occurrence.occurrenceId, index]),
  );

  // Fairness/spacing state, seeded from the schedule as it exists today and
  // updated as picks are made through the pass.
  const runningAssignmentCount = new Map<string, number>();
  members.forEach((member) => {
    runningAssignmentCount.set(
      member.memberId,
      countScheduleAssignmentsForMember(assignments, member.memberId),
    );
  });
  const assignedOccurrenceIndices = new Map<string, number[]>();
  const usedInOccurrence = new Map<string, Set<string>>();
  occurrences.forEach((occurrence) => {
    const row = assignments?.[occurrence.occurrenceId];
    const used = new Set<string>();
    usedInOccurrence.set(occurrence.occurrenceId, used);
    if (!row) return;
    const occurrenceIndex = occurrenceIndexById.get(occurrence.occurrenceId) ?? 0;
    Object.values(row).forEach((cell) => {
      getCellMemberIds(cell).forEach((memberId) => {
        used.add(memberId);
        const indices = assignedOccurrenceIndices.get(memberId) || [];
        indices.push(occurrenceIndex);
        assignedOccurrenceIndices.set(memberId, indices);
      });
    });
  });

  const entries: AutoFillEntry[] = [];
  const unfilledSlots: AutoFillSlot[] = [];

  occurrences.forEach((occurrence) => {
    const occurrenceId = occurrence.occurrenceId;
    const requirements = requirementsByOccurrence.get(occurrenceId);
    const occurrenceAssignments = assignments?.[occurrenceId] || {};
    const used = usedInOccurrence.get(occurrenceId) || new Set<string>();
    const occurrenceIndex = occurrenceIndexById.get(occurrenceId) ?? 0;

    const emptyColumns = columns.filter(
      (column) =>
        column.slot < getRequiredCount(requirements, column.positionId) &&
        !getCellPrimaryMemberId(occurrenceAssignments[column.columnKey]),
    );
    if (emptyColumns.length === 0) return;

    // Auto-fill's hard-block check for one candidate/position in this
    // occurrence: the usual eligibility rules, plus (unlike the manual
    // picker) a service-availability warning is treated as disqualifying.
    // The manual picker can show that warning live and let a human decide to
    // proceed anyway; a one-click bulk fill has no one in the loop to see it,
    // and nothing in the grid shows the warning after the cell is filled — so
    // silently placing someone who marked themselves unavailable would be an
    // invisible, unreviewable surprise. Leaving the slot unfilled instead
    // routes it into the normal "assign this one by hand" path.
    const isBlockedForAutoFill = (memberId: string, positionId: string): string =>
      getAssignmentIssue(memberId, occurrenceId, positionId) ||
      (used.has(memberId) ? "Already assigned in this service" : "") ||
      (getCrossTeamConflictWarning(memberId, occurrenceId) ? "Cross-team conflict" : "") ||
      getServiceAvailabilityWarning(memberId, occurrenceId);

    // Fill the scarcest (hardest to staff) positions in this occurrence first.
    const scarcity = (column: ScheduleSlotColumn) =>
      members.reduce(
        (count, member) =>
          isBlockedForAutoFill(member.memberId, column.positionId) ? count : count + 1,
        0,
      );
    const orderedColumns = [...emptyColumns].sort((a, b) => scarcity(a) - scarcity(b));

    orderedColumns.forEach((column) => {
      const position = positionById.get(column.positionId);
      const requiredCount = getRequiredCount(requirements, column.positionId);

      const siblingAssignedMemberIds = columns
        .filter(
          (sibling) =>
            sibling.positionId === column.positionId &&
            sibling.columnKey !== column.columnKey &&
            sibling.slot < requiredCount,
        )
        .map((sibling) => getCellPrimaryMemberId(occurrenceAssignments[sibling.columnKey]))
        .filter((memberId): memberId is string => Boolean(memberId))
        .concat(
          entries
            .filter(
              (entry) =>
                entry.occurrenceId === occurrenceId &&
                entry.positionId === column.positionId &&
                entry.columnKey !== column.columnKey,
            )
            .map((entry) => entry.memberId),
        );

      const levelBoosts = position
        ? computeLevelBalanceBoost({
            position,
            requiredCountForOccurrence: requiredCount,
            siblingAssignedMemberIds,
            members,
            qualificationLevels,
          })
        : new Map<string, boolean>();

      const recommendationStats = new Map<string, ScheduleMemberRecommendationStats>();
      members.forEach((member) => {
        const indices = assignedOccurrenceIndices.get(member.memberId) || [];
        const nearestAssignmentDistance = indices.length
          ? Math.min(...indices.map((index) => Math.abs(index - occurrenceIndex)))
          : null;
        recommendationStats.set(member.memberId, {
          assignmentCount: runningAssignmentCount.get(member.memberId) || 0,
          nearestAssignmentDistance,
          levelBalanceBoost: levelBoosts.get(member.memberId),
        });
      });

      const rows = buildScheduleMemberPickerMembers({
        members,
        positionId: column.positionId,
        assignmentQuery: "",
        currentPrimaryMemberId: "",
        hasPrimaryAssignee: false,
        duplicateFirstNames,
        getIssue: (memberId) => isBlockedForAutoFill(memberId, column.positionId),
        recommendationStats,
        filterByQuery: false,
      });

      const picked = rows.find((row) => row.eligible);
      if (!picked) {
        unfilledSlots.push({ occurrenceId, columnKey: column.columnKey });
        return;
      }

      const memberId = picked.member.memberId;
      entries.push({ occurrenceId, columnKey: column.columnKey, positionId: column.positionId, memberId });
      used.add(memberId);
      runningAssignmentCount.set(memberId, (runningAssignmentCount.get(memberId) || 0) + 1);
      const indices = assignedOccurrenceIndices.get(memberId) || [];
      indices.push(occurrenceIndex);
      assignedOccurrenceIndices.set(memberId, indices);
    });
  });

  return { entries, unfilledSlots };
};
