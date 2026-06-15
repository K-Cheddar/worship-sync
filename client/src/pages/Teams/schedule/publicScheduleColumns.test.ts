import {
  buildPublicScheduleColumns,
  buildPublicServiceSlotCounts,
} from "./publicScheduleColumns";
import type { TeamScheduleAssignments } from "../../../api/authTypes";

const positions = [
  { positionId: "dir", name: "Director" },
  { positionId: "cam", name: "Camera" },
  { positionId: "foh", name: "Front of House" },
];

describe("buildPublicScheduleColumns", () => {
  it("emits one column per position that has any assignment, in position order", () => {
    const assignments: TeamScheduleAssignments = {
      o1: {
        "dir::0": { primaryMemberId: "m1", shadows: [] },
        "foh::0": { primaryMemberId: "m2", shadows: [] },
      },
    };
    const { columns } = buildPublicScheduleColumns({ assignments, positions });
    expect(columns.map((column) => column.label)).toEqual(["Director", "Front of House"]);
    expect(columns.map((column) => column.columnKey)).toEqual(["dir::0", "foh::0"]);
  });

  it("expands a position to as many slots as the highest assigned slot, numbered", () => {
    const assignments: TeamScheduleAssignments = {
      o1: { "cam::0": { primaryMemberId: "m1", shadows: [] } },
      o2: { "cam::2": { primaryMemberId: "m2", shadows: [] } },
    };
    const { columns, slotCountByPosition } = buildPublicScheduleColumns({
      assignments,
      positions,
    });
    expect(columns.map((column) => column.label)).toEqual([
      "Camera 1",
      "Camera 2",
      "Camera 3",
    ]);
    expect(slotCountByPosition.get("cam")).toBe(3);
  });

  it("counts a shadow-only cell as an assignment", () => {
    const assignments: TeamScheduleAssignments = {
      o1: { "dir::0": { primaryMemberId: "", shadows: [{ memberId: "m9", kind: "shadow" }] } },
    };
    const { columns } = buildPublicScheduleColumns({ assignments, positions });
    expect(columns.map((column) => column.positionId)).toEqual(["dir"]);
  });

  it("ignores empty cells and unknown positions", () => {
    const assignments: TeamScheduleAssignments = {
      o1: {
        "dir::0": { primaryMemberId: "", shadows: [] },
        "ghost::0": { primaryMemberId: "m1", shadows: [] },
      },
    };
    const { columns } = buildPublicScheduleColumns({ assignments, positions });
    expect(columns).toEqual([]);
  });

  it("returns nothing for an empty schedule", () => {
    expect(buildPublicScheduleColumns({ assignments: {}, positions }).columns).toEqual([]);
    expect(
      buildPublicScheduleColumns({ assignments: undefined, positions }).columns,
    ).toEqual([]);
  });
});

describe("buildPublicServiceSlotCounts", () => {
  const serviceIdByOccurrence = new Map([
    ["o1", "svcA"],
    ["o2", "svcA"],
    ["o3", "svcB"],
  ]);

  it("scopes a position's slot count to the service that uses it", () => {
    const assignments: TeamScheduleAssignments = {
      o1: { "dir::0": { primaryMemberId: "m1", shadows: [] } },
      o3: { "cam::0": { primaryMemberId: "m2", shadows: [] } },
    };
    const counts = buildPublicServiceSlotCounts({ assignments, serviceIdByOccurrence });
    // svcA only ever uses Director — Camera (svcB's position) must not leak in.
    expect(counts.get("svcA")?.get("dir")).toBe(1);
    expect(counts.get("svcA")?.get("cam")).toBeUndefined();
    expect(counts.get("svcB")?.get("cam")).toBe(1);
    expect(counts.get("svcB")?.get("dir")).toBeUndefined();
  });

  it("takes the highest assigned slot across a service's occurrences", () => {
    const assignments: TeamScheduleAssignments = {
      o1: { "cam::0": { primaryMemberId: "m1", shadows: [] } },
      o2: { "cam::2": { primaryMemberId: "m2", shadows: [] } },
    };
    const counts = buildPublicServiceSlotCounts({ assignments, serviceIdByOccurrence });
    expect(counts.get("svcA")?.get("cam")).toBe(3);
  });

  it("ignores empty cells and occurrences with no known service", () => {
    const assignments: TeamScheduleAssignments = {
      o1: { "dir::0": { primaryMemberId: "", shadows: [] } },
      unknown: { "cam::0": { primaryMemberId: "m1", shadows: [] } },
    };
    const counts = buildPublicServiceSlotCounts({ assignments, serviceIdByOccurrence });
    expect(counts.get("svcA")).toBeUndefined();
    expect(counts.size).toBe(0);
  });
});
