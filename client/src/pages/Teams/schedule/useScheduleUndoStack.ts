import { useCallback, useReducer, useRef } from "react";
import type { ScheduleUndoEntry } from "./scheduleUndo";

/** How many steps back the grid can travel — matches a spreadsheet-style history. */
export const SCHEDULE_UNDO_LIMIT = 100;

/**
 * Session-local undo/redo history for the schedule grid. The hook owns the two
 * stacks and nothing else: applying an entry (optimistic update + server writes +
 * the concurrent-edit guard) lives in the component, because only it has the live
 * schedule state. Callers coordinate with the low-level primitives:
 *
 *   const entry = takeUndo();       // pop the newest undo step
 *   if (entry && applied(entry))    // apply it against the live grid
 *     pushRedo(entry);              // ...and make it redoable
 *
 * Fully-stale entries (every cell changed out from under us) are simply dropped
 * by not pushing them onto the counterpart stack.
 */
export type ScheduleUndoStack = {
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the step the next undo would revert, for tooltips. */
  undoLabel: string | null;
  /** Label of the step the next redo would re-apply, for tooltips. */
  redoLabel: string | null;
  /** Record a fresh user action. Clears the redo stack (a new branch of history). */
  record: (entry: ScheduleUndoEntry) => void;
  takeUndo: () => ScheduleUndoEntry | undefined;
  takeRedo: () => ScheduleUndoEntry | undefined;
  pushUndo: (entry: ScheduleUndoEntry) => void;
  pushRedo: (entry: ScheduleUndoEntry) => void;
  /** Drop all history — on schedule switch or after a stack-invalidating op. */
  reset: () => void;
};

export const useScheduleUndoStack = (): ScheduleUndoStack => {
  const undoRef = useRef<ScheduleUndoEntry[]>([]);
  const redoRef = useRef<ScheduleUndoEntry[]>([]);
  const [, force] = useReducer((n: number) => n + 1, 0);

  const record = useCallback((entry: ScheduleUndoEntry) => {
    undoRef.current = [...undoRef.current, entry].slice(-SCHEDULE_UNDO_LIMIT);
    redoRef.current = [];
    force();
  }, []);

  const takeUndo = useCallback(() => {
    const stack = undoRef.current;
    if (stack.length === 0) return undefined;
    undoRef.current = stack.slice(0, -1);
    force();
    return stack[stack.length - 1];
  }, []);

  const takeRedo = useCallback(() => {
    const stack = redoRef.current;
    if (stack.length === 0) return undefined;
    redoRef.current = stack.slice(0, -1);
    force();
    return stack[stack.length - 1];
  }, []);

  const pushUndo = useCallback((entry: ScheduleUndoEntry) => {
    undoRef.current = [...undoRef.current, entry].slice(-SCHEDULE_UNDO_LIMIT);
    force();
  }, []);

  const pushRedo = useCallback((entry: ScheduleUndoEntry) => {
    redoRef.current = [...redoRef.current, entry].slice(-SCHEDULE_UNDO_LIMIT);
    force();
  }, []);

  const reset = useCallback(() => {
    if (undoRef.current.length === 0 && redoRef.current.length === 0) return;
    undoRef.current = [];
    redoRef.current = [];
    force();
  }, []);

  const undoStack = undoRef.current;
  const redoStack = redoRef.current;

  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabel: undoStack.length ? undoStack[undoStack.length - 1].label : null,
    redoLabel: redoStack.length ? redoStack[redoStack.length - 1].label : null,
    record,
    takeUndo,
    takeRedo,
    pushUndo,
    pushRedo,
    reset,
  };
};
