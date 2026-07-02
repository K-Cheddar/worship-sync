import { act, renderHook } from "@testing-library/react";
import type { ScheduleUndoEntry } from "./scheduleUndo";
import { SCHEDULE_UNDO_LIMIT, useScheduleUndoStack } from "./useScheduleUndoStack";

const entry = (label: string): ScheduleUndoEntry => ({
  scheduleId: "sch-1",
  label,
  changes: [
    {
      occurrenceId: "svc@2026-01-04",
      cellKey: "drums#0",
      serviceDate: "2026-01-04",
      before: "",
      after: { primaryMemberId: "m1" },
    },
  ],
});

describe("useScheduleUndoStack", () => {
  it("records actions and exposes the newest as the undo label", () => {
    const { result } = renderHook(() => useScheduleUndoStack());

    expect(result.current.canUndo).toBe(false);
    act(() => result.current.record(entry("assign Jane")));
    act(() => result.current.record(entry("remove Bob")));

    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoLabel).toBe("remove Bob");
  });

  it("moves an entry from undo to redo via take + push", () => {
    const { result } = renderHook(() => useScheduleUndoStack());
    act(() => result.current.record(entry("assign Jane")));

    let taken: ScheduleUndoEntry | undefined;
    act(() => {
      taken = result.current.takeUndo();
    });
    expect(taken?.label).toBe("assign Jane");
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.pushRedo(taken!));
    expect(result.current.canRedo).toBe(true);
    expect(result.current.redoLabel).toBe("assign Jane");
  });

  it("clears the redo stack when a new action is recorded", () => {
    const { result } = renderHook(() => useScheduleUndoStack());
    act(() => result.current.record(entry("assign Jane")));
    act(() => {
      const taken = result.current.takeUndo();
      result.current.pushRedo(taken!);
    });
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.record(entry("assign Sam")));
    expect(result.current.canRedo).toBe(false);
  });

  it("caps the undo history at the limit, dropping the oldest", () => {
    const { result } = renderHook(() => useScheduleUndoStack());
    act(() => {
      for (let i = 0; i < SCHEDULE_UNDO_LIMIT + 5; i += 1) {
        result.current.record(entry(`action-${i}`));
      }
    });
    expect(result.current.undoLabel).toBe(`action-${SCHEDULE_UNDO_LIMIT + 4}`);

    // Draining exactly the limit should empty the stack (older entries dropped).
    act(() => {
      for (let i = 0; i < SCHEDULE_UNDO_LIMIT; i += 1) result.current.takeUndo();
    });
    expect(result.current.canUndo).toBe(false);
  });

  it("drops all history on reset", () => {
    const { result } = renderHook(() => useScheduleUndoStack());
    act(() => result.current.record(entry("assign Jane")));
    act(() => result.current.reset());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
