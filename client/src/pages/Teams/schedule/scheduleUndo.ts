import type {
  TeamScheduleCellAssignment,
  TeamScheduleShadowKind,
} from "../../../api/authTypes";
import { normalizeAssignmentCell, serializeAssignmentCell } from "../teamsUtils";

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

/** A single cell's value at a point in time. Strings are legacy primary IDs. */
export type ScheduleCellState = TeamScheduleCellAssignment | string;

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

export type ScheduleUndoBatchChange = {
  serviceId: string;
  positionSlotKey: string;
  serviceDate: string;
  expectedCell: TeamScheduleCellAssignment | "";
  assignment: TeamScheduleCellAssignment | "";
};

type ScheduleAssignmentMap = Record<
  string,
  Record<string, ScheduleCellState | undefined> | undefined
>;

type PendingScheduleAssignmentEdit = {
  churchId: string;
  scheduleId: string;
  field: string;
  occurrenceId: string;
  cellKey: string;
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

const cellKey = (serviceId: string, positionSlotKey: string) =>
  JSON.stringify([serviceId, positionSlotKey]);

/** Prepare the guarded per-cell payload for one Undo or Redo attempt. */
export const prepareScheduleUndoChanges = (
  entry: ScheduleUndoEntry,
  direction: "undo" | "redo",
  assignments: ScheduleAssignmentMap = {},
): { changes: ScheduleUndoBatchChange[]; skippedChanges: ScheduleCellChange[] } => {
  const ordered = direction === "undo" ? [...entry.changes].reverse() : entry.changes;
  const changes: ScheduleUndoBatchChange[] = [];
  const skippedChanges: ScheduleCellChange[] = [];

  ordered.forEach((change) => {
    const expected = direction === "undo" ? change.after : change.before;
    const desired = direction === "undo" ? change.before : change.after;
    const liveCell = assignments[change.occurrenceId]?.[change.cellKey] ?? "";
    if (!cellsMatch(liveCell, expected)) {
      skippedChanges.push(change);
      return;
    }
    changes.push({
      serviceId: change.occurrenceId,
      positionSlotKey: change.cellKey,
      serviceDate: change.serviceDate,
      expectedCell: serializeAssignmentCell(normalizeAssignmentCell(liveCell || undefined)),
      assignment: serializeAssignmentCell(normalizeAssignmentCell(desired || undefined)),
    });
  });

  return { changes, skippedChanges };
};

/** True when this history step overlaps an unsaved optimistic assignment edit. */
export const hasPendingScheduleUndoEdit = (
  entry: ScheduleUndoEntry | undefined,
  churchId: string,
  pendingEdits: Iterable<PendingScheduleAssignmentEdit>,
): boolean => {
  if (!entry) return false;
  const entryCells = new Set(entry.changes.map((change) =>
    cellKey(change.occurrenceId, change.cellKey),
  ));
  return [...pendingEdits].some((edit) =>
    edit.churchId === churchId &&
    edit.scheduleId === entry.scheduleId &&
    edit.field === "assignments" &&
    entryCells.has(cellKey(edit.occurrenceId, edit.cellKey)),
  );
};

/**
 * Keep only the part of an entry that reached its requested state. A skipped
 * cell can still count as applied after a retry if the server already has the
 * desired value (for example, the first response was lost after commit).
 */
export const resolveScheduleUndoBatchResult = (
  entry: ScheduleUndoEntry,
  direction: "undo" | "redo",
  attemptedChanges: ScheduleUndoBatchChange[],
  accepted: Array<{ serviceId: string; positionSlotKey: string }>,
  skipped: Array<{ serviceId: string; positionSlotKey: string }>,
  assignments: ScheduleAssignmentMap,
): { appliedEntry: ScheduleUndoEntry | null; skippedCount: number } => {
  const attemptedByKey = new Map(attemptedChanges.map((change) => [
    cellKey(change.serviceId, change.positionSlotKey),
    change,
  ]));
  const appliedKeys = new Set(accepted.map(({ serviceId, positionSlotKey }) =>
    cellKey(serviceId, positionSlotKey),
  ));

  skipped.forEach(({ serviceId, positionSlotKey }) => {
    const key = cellKey(serviceId, positionSlotKey);
    const attempted = attemptedByKey.get(key);
    if (!attempted) return;
    const persisted = assignments[serviceId]?.[positionSlotKey] ?? "";
    if (cellsMatch(persisted, attempted.assignment)) appliedKeys.add(key);
  });

  const attemptedKeys = new Set(attemptedByKey.keys());
  const appliedChanges = entry.changes.filter((change) => {
    const key = cellKey(change.occurrenceId, change.cellKey);
    return attemptedKeys.has(key) && appliedKeys.has(key);
  });
  return {
    appliedEntry: appliedChanges.length ? { ...entry, changes: appliedChanges } : null,
    skippedCount: attemptedKeys.size - [...appliedKeys].filter((key) => attemptedKeys.has(key)).length,
  };
};

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
