import type { TeamScheduleCellAssignment } from "../../../api/authTypes";
import {
  cellSignature,
  cellsMatch,
  diffCellToVerbs,
  hasPendingScheduleUndoEdit,
  prepareScheduleUndoChanges,
  resolveScheduleUndoBatchResult,
} from "./scheduleUndo";
import type { ScheduleCellChange, ScheduleUndoEntry } from "./scheduleUndo";

const meta = {
  serviceId: "svc@2026-01-04",
  positionSlotKey: "drums#0",
  serviceDate: "2026-01-04",
};

const makeChange = (
  occurrenceId: string,
  cellKey: string,
  before: ScheduleCellChange["before"],
  after: ScheduleCellChange["after"],
): ScheduleCellChange => ({
  occurrenceId,
  cellKey,
  serviceDate: "2026-01-04",
  before,
  after,
});

const makeEntry = (changes: ScheduleCellChange[]): ScheduleUndoEntry => ({
  scheduleId: "sch-1",
  label: "schedule edit",
  changes,
});

describe("cellSignature / cellsMatch", () => {
  it("treats an empty cell and an empty-object cell as the same", () => {
    expect(cellSignature("")).toBe(cellSignature({}));
    expect(cellsMatch("", {})).toBe(true);
  });

  it("treats a legacy primary member string as the matching object cell", () => {
    expect(cellsMatch("m1", { primaryMemberId: "m1" })).toBe(true);
    expect(cellsMatch({ primaryMemberId: " m1 " }, { primaryMemberId: "m1" })).toBe(true);
    expect(cellsMatch("", {})).toBe(true);
    expect(cellsMatch("m1", { primaryMemberId: "m2" })).toBe(false);
  });

  it("is independent of shadow ordering", () => {
    const a: TeamScheduleCellAssignment = {
      primaryMemberId: "m1",
      shadows: [
        { memberId: "s1", kind: "shadow" },
        { memberId: "s2", kind: "reverse_shadow" },
      ],
    };
    const b: TeamScheduleCellAssignment = {
      primaryMemberId: "m1",
      shadows: [
        { memberId: "s2", kind: "reverse_shadow" },
        { memberId: "s1", kind: "shadow" },
      ],
    };
    expect(cellsMatch(a, b)).toBe(true);
  });

  it("distinguishes a different primary member", () => {
    expect(cellsMatch({ primaryMemberId: "m1" }, { primaryMemberId: "m2" })).toBe(
      false,
    );
  });

  it("distinguishes the same member serving as a different shadow kind", () => {
    expect(
      cellsMatch(
        { shadows: [{ memberId: "s1", kind: "shadow" }] },
        { shadows: [{ memberId: "s1", kind: "reverse_shadow" }] },
      ),
    ).toBe(false);
  });
});

describe("diffCellToVerbs", () => {
  it("returns no verbs when the cell is unchanged", () => {
    expect(diffCellToVerbs({ primaryMemberId: "m1" }, { primaryMemberId: "m1" }, meta)).toEqual(
      [],
    );
  });

  it("clears the primary member (undo of an accidental assign)", () => {
    expect(diffCellToVerbs({ primaryMemberId: "m1" }, "", meta)).toEqual([
      { ...meta, memberId: null },
    ]);
  });

  it("restores a primary member (undo of an accidental clear)", () => {
    expect(diffCellToVerbs("", { primaryMemberId: "m1" }, meta)).toEqual([
      { ...meta, memberId: "m1" },
    ]);
  });

  it("adds a shadow", () => {
    expect(
      diffCellToVerbs("", { shadows: [{ memberId: "s1", kind: "shadow" }] }, meta),
    ).toEqual([{ ...meta, memberId: "s1", shadowAction: "add", shadowKind: "shadow" }]);
  });

  it("removes a shadow", () => {
    expect(
      diffCellToVerbs({ shadows: [{ memberId: "s1", kind: "shadow" }] }, "", meta),
    ).toEqual([
      { ...meta, memberId: "s1", shadowAction: "remove", shadowKind: "shadow" },
    ]);
  });

  it("removes before changing primary before adding, to keep the slot free", () => {
    const current: TeamScheduleCellAssignment = {
      primaryMemberId: "m1",
      shadows: [{ memberId: "s1", kind: "shadow" }],
    };
    const target: TeamScheduleCellAssignment = {
      primaryMemberId: "m2",
      shadows: [{ memberId: "s2", kind: "reverse_shadow" }],
    };
    expect(diffCellToVerbs(current, target, meta)).toEqual([
      { ...meta, memberId: "s1", shadowAction: "remove", shadowKind: "shadow" },
      { ...meta, memberId: "m2" },
      { ...meta, memberId: "s2", shadowAction: "add", shadowKind: "reverse_shadow" },
    ]);
  });

  it("leaves a preserved shadow untouched when only the primary changes", () => {
    const current: TeamScheduleCellAssignment = {
      primaryMemberId: "m1",
      shadows: [{ memberId: "s1", kind: "shadow" }],
    };
    const target: TeamScheduleCellAssignment = {
      shadows: [{ memberId: "s1", kind: "shadow" }],
    };
    expect(diffCellToVerbs(current, target, meta)).toEqual([
      { ...meta, memberId: null },
    ]);
  });
});

describe("prepareScheduleUndoChanges", () => {
  it("assigns, undoes, and redoes a primary member", () => {
    const assigned = { primaryMemberId: "m1" };
    const entry = makeEntry([makeChange(meta.serviceId, meta.positionSlotKey, "", assigned)]);

    const undo = prepareScheduleUndoChanges(entry, "undo", {
      [meta.serviceId]: { [meta.positionSlotKey]: assigned },
    });
    expect(undo.skippedChanges).toEqual([]);
    expect(undo.changes).toEqual([{
      serviceId: meta.serviceId,
      positionSlotKey: meta.positionSlotKey,
      serviceDate: meta.serviceDate,
      expectedCell: assigned,
      assignment: "",
    }]);

    const redo = prepareScheduleUndoChanges(entry, "redo", {});
    expect(redo.changes[0].assignment).toEqual(assigned);
  });

  it("undoes and redoes a member removal", () => {
    const assigned = { primaryMemberId: "m1" };
    const entry = makeEntry([makeChange(meta.serviceId, meta.positionSlotKey, assigned, "")]);

    expect(prepareScheduleUndoChanges(entry, "undo", {}).changes[0].assignment).toEqual(assigned);
    expect(prepareScheduleUndoChanges(entry, "redo", {
      [meta.serviceId]: { [meta.positionSlotKey]: assigned },
    }).changes[0].assignment).toBe("");
  });

  it("undoes a move by clearing the target before restoring the source", () => {
    const member = { primaryMemberId: "m1" };
    const source = "drums#0";
    const target = "keys#0";
    const entry = makeEntry([
      makeChange(meta.serviceId, source, member, ""),
      makeChange(meta.serviceId, target, "", member),
    ]);

    const undo = prepareScheduleUndoChanges(entry, "undo", {
      [meta.serviceId]: { [source]: "", [target]: member },
    });
    expect(undo.changes.map((change) => change.positionSlotKey)).toEqual([target, source]);
    expect(undo.changes.map((change) => change.assignment)).toEqual(["", member]);
  });

  it("undoes a two-member swap as one guarded batch", () => {
    const alice = { primaryMemberId: "alice" };
    const bob = { primaryMemberId: "bob" };
    const first = "vocal#0";
    const second = "keys#0";
    const entry = makeEntry([
      makeChange(meta.serviceId, first, alice, bob),
      makeChange(meta.serviceId, second, bob, alice),
    ]);

    const undo = prepareScheduleUndoChanges(entry, "undo", {
      [meta.serviceId]: { [first]: bob, [second]: alice },
    });
    expect(undo.changes.map((change) => change.assignment)).toEqual([bob, alice]);
    expect(undo.skippedChanges).toEqual([]);
  });

  it("adds and removes shadow assignments through Undo and Redo", () => {
    const primary = { primaryMemberId: "m1" };
    const withShadow: TeamScheduleCellAssignment = {
      primaryMemberId: "m1",
      shadows: [{ memberId: "s1", kind: "shadow" }],
    };
    const addEntry = makeEntry([makeChange(meta.serviceId, meta.positionSlotKey, primary, withShadow)]);
    const undoAdd = prepareScheduleUndoChanges(addEntry, "undo", {
      [meta.serviceId]: { [meta.positionSlotKey]: withShadow },
    });
    expect(undoAdd.changes[0].assignment).toEqual(primary);
    expect(prepareScheduleUndoChanges(addEntry, "redo", {
      [meta.serviceId]: { [meta.positionSlotKey]: primary },
    }).changes[0].assignment).toEqual(withShadow);

    const removeEntry = makeEntry([makeChange(meta.serviceId, meta.positionSlotKey, withShadow, primary)]);
    expect(prepareScheduleUndoChanges(removeEntry, "undo", {
      [meta.serviceId]: { [meta.positionSlotKey]: primary },
    }).changes[0].assignment).toEqual(withShadow);
    expect(prepareScheduleUndoChanges(removeEntry, "redo", {
      [meta.serviceId]: { [meta.positionSlotKey]: withShadow },
    }).changes[0].assignment).toEqual(primary);
  });

  it("undoes auto-fill across multiple cells as one entry", () => {
    const changes = ["vocal#0", "keys#0", "drums#0"].map((cellKey, index) =>
      makeChange(meta.serviceId, cellKey, "", { primaryMemberId: `m${index + 1}` }),
    );
    const entry = makeEntry(changes);
    const undo = prepareScheduleUndoChanges(entry, "undo", {
      [meta.serviceId]: Object.fromEntries(changes.map((change) => [change.cellKey, change.after])),
    });
    expect(undo.changes).toHaveLength(3);
    expect(undo.changes.every((change) => change.assignment === "")).toBe(true);
  });

  it("does not call a pending optimistic edit a concurrent change", () => {
    const assigned = { primaryMemberId: "m1" };
    const previous = { primaryMemberId: "m0" };
    const entry = makeEntry([makeChange(meta.serviceId, meta.positionSlotKey, previous, assigned)]);
    const latest = { primaryMemberId: "m2" };
    const pending = [{
      churchId: "church-1",
      scheduleId: "sch-1",
      field: "assignments",
      occurrenceId: meta.serviceId,
      cellKey: meta.positionSlotKey,
    }];

    expect(hasPendingScheduleUndoEdit(entry, "church-1", pending)).toBe(true);
    expect(hasPendingScheduleUndoEdit(entry, "church-2", pending)).toBe(false);
    expect(hasPendingScheduleUndoEdit(entry, "church-1", [{ ...pending[0], cellKey: "other#0" }])).toBe(false);
    const nextEdit = makeEntry([makeChange(meta.serviceId, meta.positionSlotKey, assigned, latest)]);
    expect(prepareScheduleUndoChanges(nextEdit, "undo", {
      [meta.serviceId]: { [meta.positionSlotKey]: latest },
    }).changes[0].assignment).toEqual(assigned);
  });

  it("undoes rapid sequential edits one step at a time after their saves settle", () => {
    const empty = "";
    const first = { primaryMemberId: "m1" };
    const second = { primaryMemberId: "m2" };
    const firstEntry = makeEntry([makeChange(meta.serviceId, meta.positionSlotKey, empty, first)]);
    const secondEntry = makeEntry([makeChange(meta.serviceId, meta.positionSlotKey, first, second)]);

    const undoLatest = prepareScheduleUndoChanges(secondEntry, "undo", {
      [meta.serviceId]: { [meta.positionSlotKey]: second },
    });
    expect(undoLatest.changes[0].assignment).toEqual(first);

    const undoPrevious = prepareScheduleUndoChanges(firstEntry, "undo", {
      [meta.serviceId]: { [meta.positionSlotKey]: first },
    });
    expect(undoPrevious.changes[0].assignment).toBe("");
  });

  it("skips a stale local snapshot without preparing a write", () => {
    const entry = makeEntry([makeChange(meta.serviceId, meta.positionSlotKey, "", { primaryMemberId: "m1" })]);
    const result = prepareScheduleUndoChanges(entry, "undo", {
      [meta.serviceId]: { [meta.positionSlotKey]: { primaryMemberId: "m2" } },
    });
    expect(result.changes).toEqual([]);
    expect(result.skippedChanges).toEqual(entry.changes);
  });
});

describe("resolveScheduleUndoBatchResult", () => {
  const first = makeChange("svc-1", "vocal#0", "", { primaryMemberId: "m1" });
  const second = makeChange("svc-1", "keys#0", "", { primaryMemberId: "m2" });

  it("keeps only accepted changes after a partial server skip", () => {
    const entry = makeEntry([first, second]);
    const attempted = prepareScheduleUndoChanges(entry, "undo", {
      "svc-1": { "vocal#0": first.after, "keys#0": second.after },
    }).changes;
    const result = resolveScheduleUndoBatchResult(
      entry,
      attempted,
      [{ serviceId: "svc-1", positionSlotKey: "vocal#0" }],
    );
    expect(result.appliedEntry?.changes).toEqual([first]);
    expect(result.skippedCount).toBe(1);
  });

  it("does not attribute a skipped cell to Undo when it happens to match the target", () => {
    const entry = makeEntry([first]);
    const attempted = prepareScheduleUndoChanges(entry, "undo", {
      "svc-1": { "vocal#0": first.after },
    }).changes;
    const result = resolveScheduleUndoBatchResult(
      entry,
      attempted,
      [],
    );
    expect(result.appliedEntry).toBeNull();
    expect(result.skippedCount).toBe(1);
  });

  it("recovers a lost acknowledgment from the server's idempotent accepted receipt", () => {
    const entry = makeEntry([first]);
    const attempted = prepareScheduleUndoChanges(entry, "undo", {
      "svc-1": { "vocal#0": first.after },
    }).changes;
    const result = resolveScheduleUndoBatchResult(
      entry,
      attempted,
      [{ serviceId: "svc-1", positionSlotKey: "vocal#0" }],
    );
    expect(result.appliedEntry?.changes).toEqual([first]);
    expect(result.skippedCount).toBe(0);
  });
});
