import type {
  TeamScheduleCellAssignment,
  TeamScheduleShadowKind,
} from "../../../api/authTypes";
import { normalizeAssignmentCell } from "../teamsUtils";

/**
 * Undo/redo for the schedule grid works like collaborating on a spreadsheet: each
 * mutation is recorded as a set of per-cell before/after snapshots (never a
 * whole-schedule snapshot). Undo/redo re-applies the opposite side of each cell
 * through the *existing* per-cell assignment API, so nothing new is needed on the
 * server and the server's own validation still guards every restore.
 *
 * The stack is local to the browser session (like Sheets), so it is intentionally
 * lost on refresh. It only ever reverts the operator's own edits, and a per-cell
 * divergence guard (see {@link cellSignature}) skips any cell a teammate changed
 * since — undo never clobbers someone else's newer edit.
 */

/** A single cell's value at a point in time. `""` means the cell is empty. */
export type ScheduleCellState = TeamScheduleCellAssignment | "";

/** One cell that a mutation changed, with the values on either side of it. */
export type ScheduleCellChange = {
  occurrenceId: string;
  cellKey: string;
  /** ISO date (yyyy-mm-dd) of the occurrence, required by the assignment API. */
  serviceDate: string;
  before: ScheduleCellState;
  after: ScheduleCellState;
};

/** One undoable step. Compound ops (e.g. a move) carry several cell changes. */
export type ScheduleUndoEntry = {
  scheduleId: string;
  /** Human-readable action, e.g. "remove Jane from Drums" — used in tooltips. */
  label: string;
  changes: ScheduleCellChange[];
};

/**
 * The verb-shaped payload the existing assignment endpoint understands. Restoring
 * an arbitrary cell state is expressed as a minimal sequence of these.
 */
export type ScheduleAssignmentVerb = {
  serviceId: string;
  positionSlotKey: string;
  memberId: string | null;
  serviceDate: string;
  shadowAction?: "add" | "remove";
  shadowKind?: TeamScheduleShadowKind;
};

/**
 * A stable, order-independent string identity for a cell's assignment. Two cells
 * with the same primary member and the same set of shadows produce the same
 * signature regardless of shadow ordering — used to detect whether a cell still
 * holds the value our undo entry expects before we touch it.
 */
export const cellSignature = (cell?: ScheduleCellState | null): string => {
  const normalized = normalizeAssignmentCell(cell || undefined);
  const shadows = [...normalized.shadows]
    .sort(
      (a, b) =>
        a.memberId.localeCompare(b.memberId) || a.kind.localeCompare(b.kind),
    )
    .map((shadow) => `${shadow.memberId}:${shadow.kind}`)
    .join(",");
  return `${normalized.primaryMemberId}|${shadows}`;
};

/** True when both cells describe the same primary + shadows (order-insensitive). */
export const cellsMatch = (
  a?: ScheduleCellState | null,
  b?: ScheduleCellState | null,
): boolean => cellSignature(a) === cellSignature(b);

/**
 * Compute the minimal list of assignment API calls that turn `current` into
 * `target`. Removals run before additions (and the primary change sits between)
 * so a member is freed from a slot before being re-added, keeping the server's
 * "one position per service" rule from rejecting an in-flight restore.
 */
export const diffCellToVerbs = (
  current: ScheduleCellState,
  target: ScheduleCellState,
  meta: { serviceId: string; positionSlotKey: string; serviceDate: string },
): ScheduleAssignmentVerb[] => {
  const from = normalizeAssignmentCell(current || undefined);
  const to = normalizeAssignmentCell(target || undefined);
  const verbs: ScheduleAssignmentVerb[] = [];
  const base = {
    serviceId: meta.serviceId,
    positionSlotKey: meta.positionSlotKey,
    serviceDate: meta.serviceDate,
  };

  const hasShadow = (
    shadows: { memberId: string; kind: TeamScheduleShadowKind }[],
    memberId: string,
    kind: TeamScheduleShadowKind,
  ) => shadows.some((s) => s.memberId === memberId && s.kind === kind);

  // 1. Remove shadows that should no longer be there.
  from.shadows.forEach((shadow) => {
    if (!hasShadow(to.shadows, shadow.memberId, shadow.kind)) {
      verbs.push({
        ...base,
        memberId: shadow.memberId,
        shadowAction: "remove",
        shadowKind: shadow.kind,
      });
    }
  });

  // 2. Set the primary member (or clear it) when it changed.
  if (from.primaryMemberId !== to.primaryMemberId) {
    verbs.push({ ...base, memberId: to.primaryMemberId || null });
  }

  // 3. Add shadows that are newly present.
  to.shadows.forEach((shadow) => {
    if (!hasShadow(from.shadows, shadow.memberId, shadow.kind)) {
      verbs.push({
        ...base,
        memberId: shadow.memberId,
        shadowAction: "add",
        shadowKind: shadow.kind,
      });
    }
  });

  return verbs;
};
