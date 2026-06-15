import type {
  TeamRosterMember,
  TeamScheduleCellAssignment,
} from "../../../api/authTypes";
import {
  getCellPrimaryMemberId,
  getCellShadowAssignments,
  scheduleMemberName,
  shadowKindLabel,
} from "../teamsUtils";

/**
 * Resolves a schedule into a flat, render-agnostic model for export. All the
 * name/shadow/highlight resolution lives here (pure, testable) so the actual
 * renderers (PDF today, others later) stay thin and never drift from the grid.
 */

export type ScheduleExportColumn = {
  /** makeSlotKey(positionId, slot) — used to look up the assignment cell. */
  columnKey: string;
  positionId: string;
  /** 0-based slot index within the position. */
  slot: number;
  label: string;
};

export type ScheduleExportOccurrence = {
  occurrenceId: string;
  rowLabel: string;
};

export type ScheduleExportServiceGroup = {
  serviceName: string;
  /** e.g. "Saturdays · 10:00 AM"; blank when occurrences don't share timing. */
  timingLabel: string;
  occurrences: ScheduleExportOccurrence[];
};

export type ScheduleExportInput = {
  churchName: string;
  scheduleName: string;
  dateRangeLabel: string;
  columns: ScheduleExportColumn[];
  groups: ScheduleExportServiceGroup[];
  /** Active slots for a position in one occurrence; inactive slots render muted. */
  requiredCountFor: (occurrenceId: string, positionId: string) => number;
  assignments:
    | Record<string, Record<string, TeamScheduleCellAssignment>>
    | undefined;
  members: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  /** When set, every cell holding this member is flagged for highlighting. */
  highlightMemberId?: string;
};

/** One assigned person within a cell. */
export type ScheduleExportToken = {
  name: string;
  /** "" for the primary; "shadow" / "reverse shadow" for shadows. */
  roleNote: string;
  highlighted: boolean;
};

export type ScheduleExportCellState = "inactive" | "empty" | "filled";

export type ScheduleExportCell = {
  state: ScheduleExportCellState;
  tokens: ScheduleExportToken[];
  /** True when any token in the cell is the highlighted member. */
  highlighted: boolean;
};

export type ScheduleExportRow = {
  occurrenceId: string;
  rowLabel: string;
  cells: ScheduleExportCell[];
};

export type ScheduleExportGroup = {
  serviceName: string;
  timingLabel: string;
  rows: ScheduleExportRow[];
};

export type ScheduleExportModel = {
  churchName: string;
  scheduleName: string;
  dateRangeLabel: string;
  /** Resolved name of the highlighted member, or "" when none. */
  highlightName: string;
  columnLabels: string[];
  /** Parallel to columnLabels — used for row/column focus in grid layouts. */
  columnKeys: string[];
  groups: ScheduleExportGroup[];
};

/** Shown in place of an assignee for an active-but-unfilled slot. */
export const EXPORT_EMPTY_SLOT_LABEL = "—";

const buildCell = ({
  column,
  occurrenceId,
  input,
  nameOf,
}: {
  column: ScheduleExportColumn;
  occurrenceId: string;
  input: ScheduleExportInput;
  nameOf: (memberId: string) => string;
}): ScheduleExportCell => {
  const requiredCount = input.requiredCountFor(occurrenceId, column.positionId);
  if (column.slot >= requiredCount) {
    return { state: "inactive", tokens: [], highlighted: false };
  }

  const cell = input.assignments?.[occurrenceId]?.[column.columnKey];
  const primaryId = getCellPrimaryMemberId(cell);
  const shadows = getCellShadowAssignments(cell);

  const tokens: ScheduleExportToken[] = [];
  if (primaryId) {
    tokens.push({
      name: nameOf(primaryId),
      roleNote: "",
      highlighted: primaryId === input.highlightMemberId,
    });
  }
  shadows.forEach((shadow) => {
    tokens.push({
      name: nameOf(shadow.memberId),
      roleNote: shadowKindLabel(shadow.kind).toLowerCase(),
      highlighted: shadow.memberId === input.highlightMemberId,
    });
  });

  if (tokens.length === 0) {
    return { state: "empty", tokens: [], highlighted: false };
  }
  return {
    state: "filled",
    tokens,
    highlighted: tokens.some((token) => token.highlighted),
  };
};

export const buildScheduleExportModel = (
  input: ScheduleExportInput,
): ScheduleExportModel => {
  const memberById = new Map(
    input.members.map((member) => [member.memberId, member]),
  );
  const nameOf = (memberId: string) =>
    scheduleMemberName(memberById.get(memberId), input.duplicateFirstNames);

  const groups: ScheduleExportGroup[] = input.groups.map((group) => ({
    serviceName: group.serviceName,
    timingLabel: group.timingLabel,
    rows: group.occurrences.map((occurrence) => ({
      occurrenceId: occurrence.occurrenceId,
      rowLabel: occurrence.rowLabel,
      cells: input.columns.map((column) =>
        buildCell({
          column,
          occurrenceId: occurrence.occurrenceId,
          input,
          nameOf,
        }),
      ),
    })),
  }));

  return {
    churchName: input.churchName,
    scheduleName: input.scheduleName,
    dateRangeLabel: input.dateRangeLabel,
    highlightName: input.highlightMemberId
      ? nameOf(input.highlightMemberId)
      : "",
    columnLabels: input.columns.map((column) => column.label),
    columnKeys: input.columns.map((column) => column.columnKey),
    groups,
  };
};

/** Render a single cell to its display text (used by the PDF and any text export). */
export const formatExportCellText = (cell: ScheduleExportCell): string => {
  if (cell.state === "inactive") return "";
  if (cell.state === "empty") return EXPORT_EMPTY_SLOT_LABEL;
  return cell.tokens
    .map((token) =>
      token.roleNote ? `${token.name} (${token.roleNote})` : token.name,
    )
    .join("\n");
};
