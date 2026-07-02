import type { TeamScheduleCellAssignment } from "../../../api/authTypes";
import { cellSignature, cellsMatch, diffCellToVerbs } from "./scheduleUndo";

const meta = {
  serviceId: "svc@2026-01-04",
  positionSlotKey: "drums#0",
  serviceDate: "2026-01-04",
};

describe("cellSignature / cellsMatch", () => {
  it("treats an empty cell and an empty-object cell as the same", () => {
    expect(cellSignature("")).toBe(cellSignature({}));
    expect(cellsMatch("", {})).toBe(true);
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
