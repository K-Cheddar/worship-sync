import type { PositionRequirement, TeamPosition } from "../../../api/authTypes";
import {
  buildScheduleColumns,
  computeOccurrenceFill,
  isOccurrenceStaffingSlot,
  makeSlotKey,
  parseSlotKey,
  resolveOccurrenceRequirements,
  sanitizePositionRequirements,
} from "./scheduleRequirements";

const position = (positionId: string, name = positionId): TeamPosition => ({
  positionId,
  churchId: "church-1",
  teamId: "team-1",
  name,
});

describe("slot keys", () => {
  it("uses explicit slot keys for every slot", () => {
    expect(makeSlotKey("camera", 0)).toBe("camera::0");
    expect(makeSlotKey("camera", 2)).toBe("camera::2");
  });

  it("round-trips through parseSlotKey", () => {
    expect(parseSlotKey("camera::0")).toEqual({
      positionId: "camera",
      slot: 0,
    });
    expect(parseSlotKey("camera::3")).toEqual({
      positionId: "camera",
      slot: 3,
    });
  });

  it("rejects bare and malformed keys", () => {
    expect(parseSlotKey("camera")).toBeNull();
    expect(parseSlotKey("camera::nope")).toBeNull();
    expect(parseSlotKey("camera::-1")).toBeNull();
  });

  it("tolerates positionIds that themselves contain the separator", () => {
    // lastIndexOf means only the trailing numeric slot is split off
    expect(parseSlotKey("a::b::2")).toEqual({ positionId: "a::b", slot: 2 });
    expect(makeSlotKey("a::b", 2)).toBe("a::b::2");
  });
});

describe("sanitizePositionRequirements", () => {
  it("drops blank positions and counts below one, and dedupes by position", () => {
    expect(
      sanitizePositionRequirements([
        { positionId: "camera", count: 2 },
        { positionId: "  ", count: 5 },
        { positionId: "vocal", count: 0 },
        { positionId: "camera", count: 3 },
      ]),
    ).toEqual([{ positionId: "camera", count: 3 }]);
  });

  it("preserves a minLevelId when present", () => {
    expect(
      sanitizePositionRequirements([
        { positionId: "camera", count: 1, minLevelId: "lead" },
      ]),
    ).toEqual([{ positionId: "camera", count: 1, minLevelId: "lead" }]);
  });
});

describe("resolveOccurrenceRequirements", () => {
  const teamPositionIds = ["vocal", "camera"];

  it("falls back to one slot per team position when nothing is set", () => {
    expect(
      resolveOccurrenceRequirements({
        occurrence: null,
        service: null,
        teamPositionIds,
      }),
    ).toEqual([
      { positionId: "vocal", count: 1 },
      { positionId: "camera", count: 1 },
    ]);
  });

  it("uses service requirements over the team fallback", () => {
    expect(
      resolveOccurrenceRequirements({
        occurrence: null,
        service: { positionRequirements: [{ positionId: "camera", count: 4 }] },
        teamPositionIds,
      }),
    ).toEqual([{ positionId: "camera", count: 4 }]);
  });

  it("uses an occurrence override over the service default", () => {
    expect(
      resolveOccurrenceRequirements({
        occurrence: {
          positionRequirements: [{ positionId: "camera", count: 1 }],
        },
        service: { positionRequirements: [{ positionId: "camera", count: 4 }] },
        teamPositionIds,
      }),
    ).toEqual([{ positionId: "camera", count: 1 }]);
  });
});

describe("buildScheduleColumns", () => {
  const positions = [position("vocal", "Vocal"), position("camera", "Camera")];

  it("expands a position to the max count any occurrence needs and labels slots", () => {
    const requirementsByOccurrence = new Map([
      [
        "sun",
        [
          { positionId: "camera", count: 2 },
          { positionId: "vocal", count: 1 },
        ],
      ],
      ["wed", [{ positionId: "camera", count: 1 }]],
    ]);
    const columns = buildScheduleColumns({
      occurrences: [{ occurrenceId: "sun" }, { occurrenceId: "wed" }],
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal", "camera"],
    });
    expect(columns.map((c) => c.columnKey)).toEqual([
      "vocal::0",
      "camera::0",
      "camera::1",
    ]);
    expect(columns.map((c) => c.label)).toEqual([
      "Vocal",
      "Camera 1",
      "Camera 2",
    ]);
  });

  it("omits positions that no occurrence requires and skips unknown positions", () => {
    const requirementsByOccurrence = new Map([
      [
        "sun",
        [
          { positionId: "vocal", count: 1 },
          { positionId: "ghost", count: 2 },
        ],
      ],
    ]);
    const columns = buildScheduleColumns({
      occurrences: [{ occurrenceId: "sun" }],
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal", "camera"],
    });
    expect(columns.map((c) => c.columnKey)).toEqual(["vocal::0"]);
  });

  it("keeps additional positions hidden until a date adds that position", () => {
    const args = {
      occurrences: [{ occurrenceId: "sun" }],
      requirementsByOccurrence: new Map([
        ["sun", [{ positionId: "vocal", count: 1 }]],
      ]),
      positions,
      teamPositionIds: ["vocal", "camera"],
    };
    expect(
      buildScheduleColumns(args).map((column) => column.columnKey),
    ).toEqual(["vocal::0"]);
    const columns = buildScheduleColumns({
      ...args,
      additionalPositionSlots: { sun: ["vocal::1"] },
    });
    expect(columns.map((column) => column.columnKey)).toEqual([
      "vocal::0",
      "vocal::1",
    ]);
  });
});

describe("isOccurrenceStaffingSlot", () => {
  const column = {
    columnKey: "vocal::1",
    positionId: "vocal",
    slot: 1,
  };

  it("counts baseline requirement slots and occurrence-added slots only", () => {
    const requirements = [{ positionId: "vocal", count: 1 }];
    expect(
      isOccurrenceStaffingSlot(
        { columnKey: "vocal::0", positionId: "vocal", slot: 0 },
        requirements,
      ),
    ).toBe(true);
    expect(isOccurrenceStaffingSlot(column, requirements)).toBe(false);
    expect(isOccurrenceStaffingSlot(column, requirements, ["vocal::1"])).toBe(
      true,
    );
  });
});

describe("computeOccurrenceFill", () => {
  const positions = [position("vocal", "Vocal"), position("camera", "Camera")];
  const requirementsByOccurrence = new Map([
    [
      "sun",
      [
        { positionId: "camera", count: 2 },
        { positionId: "vocal", count: 1 },
      ],
    ],
    ["wed", [{ positionId: "camera", count: 1 }]],
  ]);
  // Union columns across occurrences: vocal::0, camera::0, camera::1.
  const columns = buildScheduleColumns({
    occurrences: [{ occurrenceId: "sun" }, { occurrenceId: "wed" }],
    requirementsByOccurrence,
    positions,
    teamPositionIds: ["vocal", "camera"],
  });

  it("counts filled required slots for an occurrence", () => {
    expect(
      computeOccurrenceFill(columns, requirementsByOccurrence.get("sun"), {
        "vocal::0": { primaryMemberId: "m1" },
        "camera::0": { primaryMemberId: "m2" },
      }),
    ).toEqual({ filled: 2, required: 3, accepted: 0, declined: 0 });
  });

  it("ignores columns the occurrence does not require", () => {
    // wed needs only camera x1, so camera::1 and vocal::0 are out of scope even
    // when they carry an assignment.
    expect(
      computeOccurrenceFill(columns, requirementsByOccurrence.get("wed"), {
        "camera::0": { primaryMemberId: "m2" },
        "camera::1": { primaryMemberId: "should-not-count" },
        "vocal::0": { primaryMemberId: "should-not-count" },
      }),
    ).toEqual({ filled: 1, required: 1, accepted: 0, declined: 0 });
  });

  it("treats a slot without a primary member as unfilled", () => {
    expect(
      computeOccurrenceFill(columns, requirementsByOccurrence.get("sun"), {
        "vocal::0": { shadows: [] },
      }),
    ).toEqual({ filled: 0, required: 3, accepted: 0, declined: 0 });
  });

  it("reports nothing required when the occurrence needs no positions", () => {
    expect(computeOccurrenceFill(columns, undefined, undefined)).toEqual({
      filled: 0,
      required: 0,
      accepted: 0,
      declined: 0,
    });
  });
});

describe("computeOccurrenceFill with additionalPositionSlots", () => {
  const positions = [position("vocal", "Vocal"), position("camera", "Camera")];
  // Four baseline slots across two positions so the examples read as 4/4.
  const baselineRequirements: PositionRequirement[] = [
    { positionId: "vocal", count: 2 },
    { positionId: "camera", count: 2 },
  ];
  const baselineAssignments = {
    "vocal::0": { primaryMemberId: "m1" },
    "vocal::1": { primaryMemberId: "m2" },
    "camera::0": { primaryMemberId: "m3" },
    "camera::1": { primaryMemberId: "m4" },
  };

  const columnsFor = (additionalPositionSlots?: Record<string, string[]>) =>
    buildScheduleColumns({
      occurrences: [{ occurrenceId: "sun" }, { occurrenceId: "wed" }],
      requirementsByOccurrence: new Map([
        ["sun", baselineRequirements],
        ["wed", baselineRequirements],
      ]),
      additionalPositionSlots,
      positions,
      teamPositionIds: ["vocal", "camera"],
    });

  it("reports baseline 4/4 when every core slot is filled", () => {
    expect(
      computeOccurrenceFill(
        columnsFor(),
        baselineRequirements,
        baselineAssignments,
      ),
    ).toEqual({ filled: 4, required: 4, accepted: 0, declined: 0 });
  });

  it("raises the denominator for one empty occurrence-added slot (4/5)", () => {
    // Intentional behavior change: additionalPositionSlots are staffing needs
    // for that occurrence, not optional extras outside the fill total.
    expect(
      computeOccurrenceFill(
        columnsFor({ sun: ["vocal::2"] }),
        baselineRequirements,
        baselineAssignments,
        undefined,
        ["vocal::2"],
      ),
    ).toEqual({ filled: 4, required: 5, accepted: 0, declined: 0 });
  });

  it("counts a filled occurrence-added slot toward the total (5/5)", () => {
    expect(
      computeOccurrenceFill(
        columnsFor({ sun: ["vocal::2"] }),
        baselineRequirements,
        { ...baselineAssignments, "vocal::2": { primaryMemberId: "m5" } },
        undefined,
        ["vocal::2"],
      ),
    ).toEqual({ filled: 5, required: 5, accepted: 0, declined: 0 });
  });

  it("counts an additional slot for a position that already has baseline slots", () => {
    expect(
      computeOccurrenceFill(
        columnsFor({ sun: ["camera::2"] }),
        baselineRequirements,
        baselineAssignments,
        undefined,
        ["camera::2"],
      ),
    ).toEqual({ filled: 4, required: 5, accepted: 0, declined: 0 });
  });

  it("counts an additional slot for a different position with no baseline requirement", () => {
    const vocalOnly: PositionRequirement[] = [
      { positionId: "vocal", count: 1 },
    ];
    const columns = buildScheduleColumns({
      occurrences: [{ occurrenceId: "sun" }],
      requirementsByOccurrence: new Map([["sun", vocalOnly]]),
      additionalPositionSlots: { sun: ["camera::0"] },
      positions,
      teamPositionIds: ["vocal", "camera"],
    });
    expect(
      computeOccurrenceFill(
        columns,
        vocalOnly,
        { "vocal::0": { primaryMemberId: "m1" } },
        undefined,
        ["camera::0"],
      ),
    ).toEqual({ filled: 1, required: 2, accepted: 0, declined: 0 });
  });

  it("counts a pending assignment on an added slot as filled", () => {
    expect(
      computeOccurrenceFill(
        columnsFor({ sun: ["vocal::2"] }),
        baselineRequirements,
        { ...baselineAssignments, "vocal::2": { primaryMemberId: "m5" } },
        undefined,
        ["vocal::2"],
      ),
    ).toEqual({ filled: 5, required: 5, accepted: 0, declined: 0 });
  });

  it("counts an accepted assignment on an added slot as filled and accepted", () => {
    expect(
      computeOccurrenceFill(
        columnsFor({ sun: ["vocal::2"] }),
        baselineRequirements,
        { ...baselineAssignments, "vocal::2": { primaryMemberId: "m5" } },
        { "vocal::2": { memberId: "m5", response: "accepted" } },
        ["vocal::2"],
      ),
    ).toEqual({ filled: 5, required: 5, accepted: 1, declined: 0 });
  });

  it("does not count a declined assignment on an added slot as filled", () => {
    expect(
      computeOccurrenceFill(
        columnsFor({ sun: ["vocal::2"] }),
        baselineRequirements,
        { ...baselineAssignments, "vocal::2": { primaryMemberId: "m5" } },
        { "vocal::2": { memberId: "m5", response: "declined" } },
        ["vocal::2"],
      ),
    ).toEqual({ filled: 4, required: 5, accepted: 0, declined: 1 });
  });

  it("returns the denominator to the baseline when the added slot is removed", () => {
    const withAdditional = columnsFor({ sun: ["vocal::2"] });
    expect(
      computeOccurrenceFill(
        withAdditional,
        baselineRequirements,
        { ...baselineAssignments, "vocal::2": { primaryMemberId: "m5" } },
        undefined,
        ["vocal::2"],
      ).required,
    ).toBe(5);
    expect(
      computeOccurrenceFill(columnsFor(), baselineRequirements, {
        ...baselineAssignments,
        "vocal::2": { primaryMemberId: "m5" },
      }),
    ).toEqual({ filled: 4, required: 4, accepted: 0, declined: 0 });
  });

  it("counts multiple added slots on one occurrence", () => {
    expect(
      computeOccurrenceFill(
        columnsFor({ sun: ["vocal::2", "camera::2"] }),
        baselineRequirements,
        {
          ...baselineAssignments,
          "vocal::2": { primaryMemberId: "m5" },
        },
        undefined,
        ["vocal::2", "camera::2"],
      ),
    ).toEqual({ filled: 5, required: 6, accepted: 0, declined: 0 });
  });

  it("does not let one occurrence's added slots affect another's fill total", () => {
    const columns = columnsFor({ sun: ["vocal::2"] });
    expect(
      computeOccurrenceFill(
        columns,
        baselineRequirements,
        baselineAssignments,
        undefined,
        ["vocal::2"],
      ),
    ).toEqual({ filled: 4, required: 5, accepted: 0, declined: 0 });
    expect(
      computeOccurrenceFill(columns, baselineRequirements, baselineAssignments),
    ).toEqual({ filled: 4, required: 4, accepted: 0, declined: 0 });
  });
});

describe("computeOccurrenceFill with responses", () => {
  const columns = [
    {
      columnKey: "cam::0",
      positionId: "cam",
      slot: 0,
      label: "Camera",
      position: {},
    },
    {
      columnKey: "cam::1",
      positionId: "cam",
      slot: 1,
      label: "Camera",
      position: {},
    },
  ] as unknown as Parameters<typeof computeOccurrenceFill>[0];
  const requirements = [
    { positionId: "cam", count: 2 },
  ] as PositionRequirement[];

  // Before accept/decline, "assigned" and "covered" were the same thing. An
  // owner scanning fill counts for gaps must not skip the one service where
  // somebody has said no.
  it("does not count a declined slot as filled", () => {
    expect(
      computeOccurrenceFill(
        columns,
        requirements,
        {
          "cam::0": { primaryMemberId: "m1" },
          "cam::1": { primaryMemberId: "m2" },
        },
        { "cam::0": { memberId: "m1", response: "declined" } },
      ),
    ).toEqual({ filled: 1, required: 2, accepted: 0, declined: 1 });
  });

  it("counts a pending slot as filled and reports accepted separately", () => {
    expect(
      computeOccurrenceFill(
        columns,
        requirements,
        {
          "cam::0": { primaryMemberId: "m1" },
          "cam::1": { primaryMemberId: "m2" },
        },
        { "cam::0": { memberId: "m1", response: "accepted" } },
      ),
    ).toEqual({ filled: 2, required: 2, accepted: 1, declined: 0 });
  });

  it("ignores a response from someone who no longer holds the slot", () => {
    expect(
      computeOccurrenceFill(
        columns,
        requirements,
        { "cam::0": { primaryMemberId: "m9" } },
        { "cam::0": { memberId: "m1", response: "declined" } },
      ),
    ).toEqual({ filled: 1, required: 2, accepted: 0, declined: 0 });
  });
});
