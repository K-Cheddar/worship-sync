import { formatOccurrenceRowLabel } from "@/utils/teamScheduleOccurrences";
import type {
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleAttendanceStatus,
  TeamScheduleOccurrence,
} from "../../../api/authTypes";
import {
  getCellMemberIds,
  getCellPrimaryMemberId,
  scheduleMemberName,
} from "../teamsUtils";
import type { ScheduleSlotColumn } from "./scheduleRequirements";

export type ScheduleAttendanceRow = {
  occurrenceId: string;
  occurrenceLabel: string;
  occurrenceName: string;
  columnKey: string;
  positionId: string;
  positionLabel: string;
  memberId: string;
  memberLabel: string;
  status: TeamScheduleAttendanceStatus | "";
  isPrimary: boolean;
};

export type RescheduleSuggestion = {
  memberId: string;
  memberLabel: string;
  assignmentCount: number;
};

export const getAttendanceStatus = (
  schedule: Pick<TeamSchedule, "attendance"> | null | undefined,
  occurrenceId: string,
  memberId: string,
): TeamScheduleAttendanceStatus | "" => {
  const status = schedule?.attendance?.[occurrenceId]?.[memberId]?.status;
  return status === "present" || status === "absent" ? status : "";
};

export const buildAttendanceRows = ({
  schedule,
  occurrences,
  columns,
  members,
  duplicateFirstNames,
  occurrenceTimingById,
  requiredCountFor,
}: {
  schedule: TeamSchedule | null;
  occurrences: TeamScheduleOccurrence[];
  columns: ScheduleSlotColumn[];
  members: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  occurrenceTimingById: Map<
    string,
    { sharedWeekday: string | null; sharedTime: string | null }
  >;
  requiredCountFor: (occurrenceId: string, positionId: string) => number;
}): ScheduleAttendanceRow[] => {
  if (!schedule) return [];
  const memberById = new Map(members.map((member) => [member.memberId, member]));
  const seen = new Set<string>();
  const rows: ScheduleAttendanceRow[] = [];
  occurrences.forEach((occurrence) => {
    columns.forEach((column) => {
      if (column.slot >= requiredCountFor(occurrence.occurrenceId, column.positionId)) {
        return;
      }
      const assignmentCell =
        schedule.assignments?.[occurrence.occurrenceId]?.[column.columnKey];
      const primaryMemberId = getCellPrimaryMemberId(assignmentCell);
      getCellMemberIds(assignmentCell).forEach((memberId) => {
        const member = memberById.get(memberId);
        if (!member) return;
        seen.add(`${occurrence.occurrenceId}|${memberId}`);
        rows.push({
          occurrenceId: occurrence.occurrenceId,
          occurrenceLabel: formatOccurrenceRowLabel(
            occurrence,
            occurrenceTimingById.get(occurrence.occurrenceId) || {
              sharedWeekday: null,
              sharedTime: null,
            },
          ),
          occurrenceName: occurrence.name,
          columnKey: column.columnKey,
          positionId: column.positionId,
          positionLabel: column.label,
          memberId,
          memberLabel: scheduleMemberName(member, duplicateFirstNames),
          status: getAttendanceStatus(schedule, occurrence.occurrenceId, memberId),
          isPrimary: memberId === primaryMemberId,
        });
      });
    });
  });
  occurrences.forEach((occurrence) => {
    const attendanceRow = schedule.attendance?.[occurrence.occurrenceId] || {};
    Object.entries(attendanceRow).forEach(([memberId, entry]) => {
      if (seen.has(`${occurrence.occurrenceId}|${memberId}`)) return;
      const member = memberById.get(memberId);
      if (!member || entry.status !== "absent") return;
      rows.push({
        occurrenceId: occurrence.occurrenceId,
        occurrenceLabel: formatOccurrenceRowLabel(
          occurrence,
          occurrenceTimingById.get(occurrence.occurrenceId) || {
            sharedWeekday: null,
            sharedTime: null,
          },
        ),
        occurrenceName: occurrence.name,
        columnKey: entry.columnKey || "",
        positionId: entry.positionId || "",
        positionLabel: entry.positionLabel || "Recorded service",
        memberId,
        memberLabel: scheduleMemberName(member, duplicateFirstNames),
        status: entry.status,
        isPrimary: false,
      });
    });
  });
  return rows;
};

export const countAttendanceStatuses = (rows: ScheduleAttendanceRow[]) => ({
  present: rows.filter((row) => row.status === "present").length,
  absent: rows.filter((row) => row.status === "absent").length,
  unmarked: rows.filter((row) => !row.status).length,
});

export const buildRescheduleSuggestions = ({
  row,
  members,
  duplicateFirstNames,
  assignmentCounts,
  excludedMemberIds,
  getIssue,
}: {
  row: ScheduleAttendanceRow;
  members: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  assignmentCounts: Map<string, number>;
  excludedMemberIds?: Set<string>;
  getIssue: (
    memberId: string,
    occurrenceId: string,
    positionId: string,
  ) => string;
}): RescheduleSuggestion[] =>
  members
    .filter((member) => member.memberId !== row.memberId)
    .filter((member) => !excludedMemberIds?.has(member.memberId))
    .filter(
      (member) =>
        !getIssue(member.memberId, row.occurrenceId, row.positionId),
    )
    .map((member) => ({
      memberId: member.memberId,
      memberLabel: scheduleMemberName(member, duplicateFirstNames),
      assignmentCount: assignmentCounts.get(member.memberId) || 0,
    }))
    .sort(
      (first, second) =>
        first.assignmentCount - second.assignmentCount ||
        first.memberLabel.localeCompare(second.memberLabel),
    )
    .slice(0, 3);
