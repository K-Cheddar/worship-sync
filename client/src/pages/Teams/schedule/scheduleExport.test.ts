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

  it("keeps an occurrence-added slot active beyond the baseline required count", () => {
    // Intentional: additionalPositionSlots are staffing needs for that date,
    // so export must show them as empty or filled — not muted inactive cells.
    const model = buildScheduleExportModel(
      baseInput({
        columns: [
          {
            columnKey: "dir::0",
            positionId: "dir",
            slot: 0,
            label: "Director",
          },
          {
            columnKey: "cam::0",
            positionId: "cam",
            slot: 0,
            label: "Camera 1",
          },
          {
            columnKey: "cam::1",
            positionId: "cam",
            slot: 1,
            label: "Camera 2",
          },
        ],
        requiredCountFor: (_occurrenceId, positionId) =>
          positionId === "cam" ? 1 : 1,
        additionalPositionSlots: { o1: ["cam::1"] },
        assignments: {
          o1: {
            "dir::0": cell("m1"),
            "cam::0": cell("m2"),
          },
        },
      }),
    );
    const cells = model.groups[0].rows[0].cells;
    expect(cells[1].state).toBe("filled");
    expect(cells[2].state).toBe("empty");
    expect(formatExportCellText(cells[2])).toBe("—");
  });

  it("activates a position that only exists as an occurrence-added slot", () => {
    const model = buildScheduleExportModel(
      baseInput({
        columns: [
          {
            columnKey: "dir::0",
            positionId: "dir",
            slot: 0,
            label: "Director",
          },
          { columnKey: "cam::0", positionId: "cam", slot: 0, label: "Camera" },
        ],
        requiredCountFor: (_occurrenceId, positionId) =>
          positionId === "dir" ? 1 : 0,
        additionalPositionSlots: { o1: ["cam::0"] },
        assignments: {
          o1: {
            "dir::0": cell("m1"),
            "cam::0": cell("m2"),
          },
        },
      }),
    );
    const cells = model.groups[0].rows[0].cells;
    expect(cells[0].state).toBe("filled");
    expect(cells[1].state).toBe("filled");
    expect(cells[1].tokens[0]?.name).toBe("Josh");
  });

  it("does not activate an added slot on a different occurrence", () => {
    const model = buildScheduleExportModel(
      baseInput({
        columns: [
          {
            columnKey: "cam::0",
            positionId: "cam",
            slot: 0,
            label: "Camera 1",
          },
          {
            columnKey: "cam::1",
            positionId: "cam",
            slot: 1,
            label: "Camera 2",
          },
        ],
        groups: [
          {
            serviceName: "Sabbath",
            timingLabel: "",
            occurrences: [
              { occurrenceId: "o1", rowLabel: "May 2" },
              { occurrenceId: "o2", rowLabel: "May 9" },
            ],
          },
        ],
        requiredCountFor: () => 1,
        additionalPositionSlots: { o1: ["cam::1"] },
        assignments: {
          o1: { "cam::0": cell("m2") },
          o2: { "cam::0": cell("m2") },
        },
      }),
    );
    expect(model.groups[0].rows[0].cells[1].state).toBe("empty");
    expect(model.groups[0].rows[1].cells[1].state).toBe("inactive");
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

  it("resolves both microphone and IEM assignments on one slot", () => {
    const model = buildScheduleExportModel(baseInput({
      equipmentAssignments: {
        o1: { "dir::0": [
          { id: "mic-1", category: "microphone" },
          { id: "iem-1", category: "iem" },
        ] },
      },
      equipmentCatalog: [
        { id: "mic-1", category: "microphone", name: "Black", type: "Handheld", color: "#123456" },
        { id: "iem-1", category: "iem", name: "IEM 1", subtype: "wireless-beltpack", color: "#654321" },
      ],
    }));
    const director = model.groups[0].rows[0].cells[0];
    expect(director.equipment).toEqual([
      { id: "mic-1", category: "microphone", name: "Black", type: "Handheld", color: "#123456" },
      { id: "iem-1", category: "iem", name: "IEM 1", subtype: "wireless-beltpack", color: "#654321" },
    ]);
    expect(formatExportCellText(director)).toBe("Brandon\nMic: Black\nIEM: IEM 1");
  });

  it("keeps assigned equipment visible when the slot has no person", () => {
    const model = buildScheduleExportModel(baseInput({
      assignments: { o1: {} },
      equipmentAssignments: { o1: { "dir::0": [{ id: "iem-1", category: "iem" }] } },
      equipmentCatalog: [{ id: "iem-1", category: "iem", name: "IEM 1" }],
    }));
    const director = model.groups[0].rows[0].cells[0];
    expect(director).toMatchObject({ state: "filled", tokens: [] });
    expect(formatExportCellText(director)).toBe("IEM: IEM 1");
  });

  it("ignores missing catalog IDs and equipment on inactive slots", () => {
    const model = buildScheduleExportModel(baseInput({
      equipmentAssignments: {
        o1: {
          "dir::0": [{ id: "deleted", category: "microphone" }],
          "cam::0": [{ id: "iem-1", category: "iem" }],
        },
      },
      equipmentCatalog: [{ id: "iem-1", category: "iem", name: "IEM 1" }],
      requiredCountFor: (_occurrenceId, positionId) => positionId === "dir" ? 1 : 0,
    }));
    expect(model.groups[0].rows[0].cells[0].equipment).toEqual([]);
    expect(model.groups[0].rows[0].cells[1]).toMatchObject({ state: "inactive", equipment: [] });
  });

  it("keeps equipment separate from member highlighting and supports added slots", () => {
    const model = buildScheduleExportModel(baseInput({
      columns: [
        { columnKey: "dir::0", positionId: "dir", slot: 0, label: "Director" },
        { columnKey: "dir::1", positionId: "dir", slot: 1, label: "Director 2" },
      ],
      requiredCountFor: () => 1,
      additionalPositionSlots: { o1: ["dir::1"] },
      assignments: { o1: { "dir::0": cell("m1") } },
      equipmentAssignments: {
        o1: { "dir::0": [{ id: "iem-1", category: "iem" }], "dir::1": [{ id: "iem-1", category: "iem" }] },
      },
      equipmentCatalog: [{ id: "iem-1", category: "iem", name: "IEM 1" }],
      highlightMemberId: "m1",
    }));
    expect(model.groups[0].rows[0].cells[0]).toMatchObject({ highlighted: true, tokens: [{ highlighted: true }] });
    expect(model.groups[0].rows[0].cells[1]).toMatchObject({ state: "filled", highlighted: false, tokens: [], equipment: [{ name: "IEM 1" }] });
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
