import {
  buildScheduleExportModel,
  formatExportCellText,
  type ScheduleExportInput,
} from "./scheduleExport";
import type {
  TeamRosterMember,
  TeamScheduleCellAssignment,
} from "../../../api/authTypes";

const member = (memberId: string, firstName: string): TeamRosterMember =>
  ({
    memberId,
    churchId: "c",
    firstName,
    lastName: "",
    positionIds: [],
  }) as unknown as TeamRosterMember;

const cell = (
  primaryMemberId: string,
  shadows: TeamScheduleCellAssignment["shadows"] = [],
): TeamScheduleCellAssignment => ({ primaryMemberId, shadows });

const baseInput = (
  overrides: Partial<ScheduleExportInput> = {},
): ScheduleExportInput => ({
  churchName: "Grace Chapel",
  scheduleName: "May 2026",
  dateRangeLabel: "May 1 – May 31, 2026",
  columns: [
    { columnKey: "dir::0", positionId: "dir", slot: 0, label: "Director" },
    { columnKey: "cam::0", positionId: "cam", slot: 0, label: "Camera 1" },
  ],
  groups: [
    {
      serviceName: "Sabbath",
      timingLabel: "Saturdays · 10:00 AM",
      occurrences: [{ occurrenceId: "o1", rowLabel: "May 2" }],
    },
  ],
  requiredCountFor: () => 1,
  assignments: {
    o1: {
      "dir::0": cell("m1"),
      "cam::0": cell("m2", [{ memberId: "m3", kind: "shadow" }]),
    },
  },
  members: [
    member("m1", "Brandon"),
    member("m2", "Josh"),
    member("m3", "Danielle"),
  ],
  duplicateFirstNames: new Set<string>(),
  ...overrides,
});

describe("buildScheduleExportModel", () => {
  it("carries header metadata and column labels", () => {
    const model = buildScheduleExportModel(baseInput());
    expect(model.churchName).toBe("Grace Chapel");
    expect(model.scheduleName).toBe("May 2026");
    expect(model.dateRangeLabel).toBe("May 1 – May 31, 2026");
    expect(model.columnLabels).toEqual(["Director", "Camera 1"]);
    expect(model.columnKeys).toEqual(["dir::0", "cam::0"]);
    expect(model.groups[0].rows[0].occurrenceId).toBe("o1");
  });

  it("resolves a primary and a shadow into tokens with role notes", () => {
    const model = buildScheduleExportModel(baseInput());
    const [director, camera] = model.groups[0].rows[0].cells;
    expect(director).toMatchObject({ state: "filled" });
    expect(director.tokens).toEqual([
      { name: "Brandon", roleNote: "", highlighted: false },
    ]);
    expect(camera.tokens).toEqual([
      { name: "Josh", roleNote: "", highlighted: false },
      { name: "Danielle", roleNote: "shadow", highlighted: false },
    ]);
  });

  it("marks an active-but-unassigned slot as empty", () => {
    const model = buildScheduleExportModel(
      baseInput({ assignments: { o1: { "dir::0": cell("m1") } } }),
    );
    const camera = model.groups[0].rows[0].cells[1];
    expect(camera.state).toBe("empty");
    expect(formatExportCellText(camera)).toBe("—");
  });

  it("marks a slot beyond the required count as inactive", () => {
    const model = buildScheduleExportModel(
      baseInput({
        requiredCountFor: (_occurrenceId, positionId) =>
          positionId === "cam" ? 0 : 1,
      }),
    );
    const camera = model.groups[0].rows[0].cells[1];
    expect(camera.state).toBe("inactive");
    expect(formatExportCellText(camera)).toBe("");
  });

  it("flags cells and tokens for the highlighted member and resolves their name", () => {
    const model = buildScheduleExportModel(
      baseInput({ highlightMemberId: "m3" }),
    );
    expect(model.highlightName).toBe("Danielle");
    const camera = model.groups[0].rows[0].cells[1];
    expect(camera.highlighted).toBe(true);
    expect(
      camera.tokens.find((token) => token.name === "Danielle")?.highlighted,
    ).toBe(true);
    const director = model.groups[0].rows[0].cells[0];
    expect(director.highlighted).toBe(false);
  });
});

describe("formatExportCellText", () => {
  it("joins multiple assignees on separate lines with role suffixes", () => {
    const model = buildScheduleExportModel(baseInput());
    expect(formatExportCellText(model.groups[0].rows[0].cells[1])).toBe(
      "Josh\nDanielle (shadow)",
    );
  });
});
