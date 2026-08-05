import type { TeamPosition } from "../../../api/authTypes";
import {
  buildScheduleColumns,
  computeOccurrenceFill,
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
    expect(parseSlotKey("camera::0")).toEqual({ positionId: "camera", slot: 0 });
    expect(parseSlotKey("camera::3")).toEqual({ positionId: "camera", slot: 3 });
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
      sanitizePositionRequirements([{ positionId: "camera", count: 1, minLevelId: "lead" }]),
    ).toEqual([{ positionId: "camera", count: 1, minLevelId: "lead" }]);
  });

});

describe("resolveOccurrenceRequirements", () => {
  const teamPositionIds = ["vocal", "camera"];

  it("falls back to one slot per team position when nothing is set", () => {
    expect(
      resolveOccurrenceRequirements({ occurrence: null, service: null, teamPositionIds }),
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
        occurrence: { positionRequirements: [{ positionId: "camera", count: 1 }] },
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
      ["sun", [{ positionId: "camera", count: 2 }, { positionId: "vocal", count: 1 }]],
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
    expect(columns.map((c) => c.label)).toEqual(["Vocal", "Camera 1", "Camera 2"]);
  });

  it("omits positions that no occurrence requires and skips unknown positions", () => {
    const requirementsByOccurrence = new Map([
      ["sun", [{ positionId: "vocal", count: 1 }, { positionId: "ghost", count: 2 }]],
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
    expect(buildScheduleColumns(args).map((column) => column.columnKey)).toEqual([
      "vocal::0",
    ]);
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

describe("computeOccurrenceFill", () => {
  const positions = [position("vocal", "Vocal"), position("camera", "Camera")];
  const requirementsByOccurrence = new Map([
    ["sun", [{ positionId: "camera", count: 2 }, { positionId: "vocal", count: 1 }]],
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
    ).toEqual({ filled: 2, required: 3 });
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
    ).toEqual({ filled: 1, required: 1 });
  });

  it("does not add an additional position to the fill requirement", () => {
    const additionalColumns = buildScheduleColumns({
      occurrences: [{ occurrenceId: "sun" }],
      requirementsByOccurrence: new Map([
        ["sun", [{ positionId: "vocal", count: 1 }]],
      ]),
      additionalPositionSlots: { sun: ["vocal::1"] },
      positions,
      teamPositionIds: ["vocal", "camera"],
    });
    expect(
      computeOccurrenceFill(additionalColumns, [{ positionId: "vocal", count: 1 }], {
        "vocal::0": { primaryMemberId: "m1" },
        "vocal::1": { primaryMemberId: "m2" },
      }),
    ).toEqual({ filled: 1, required: 1 });
  });

  it("treats a slot without a primary member as unfilled", () => {
    expect(
      computeOccurrenceFill(columns, requirementsByOccurrence.get("sun"), {
        "vocal::0": { shadows: [] },
      }),
    ).toEqual({ filled: 0, required: 3 });
  });

  it("reports nothing required when the occurrence needs no positions", () => {
    expect(computeOccurrenceFill(columns, undefined, undefined)).toEqual({
      filled: 0,
      required: 0,
    });
  });
});
