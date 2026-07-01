import type {
  PositionRequirement,
  TeamPosition,
  TeamRosterMember,
  TeamScheduleCellAssignment,
} from "../../../api/authTypes";
import { buildScheduleColumns, makeSlotKey } from "./scheduleRequirements";
import {
  buildOccurrenceSummaryGroups,
  formatOccurrenceMessage,
} from "./occurrenceSummary";

const position = (
  positionId: string,
  name: string,
  groupId?: string,
): TeamPosition => ({
  positionId,
  churchId: "church-1",
  teamId: "team-1",
  name,
  ...(groupId ? { groupId } : {}),
});

const member = (
  memberId: string,
  firstName: string,
  lastName = "X",
): TeamRosterMember => ({
  memberId,
  churchId: "church-1",
  firstName,
  lastName,
  positionIds: [],
  blockoutDates: [],
});

const cell = (
  primaryMemberId?: string,
  shadows?: TeamScheduleCellAssignment["shadows"],
): TeamScheduleCellAssignment => ({
  ...(primaryMemberId ? { primaryMemberId } : {}),
  ...(shadows ? { shadows } : {}),
});

// A realistic setup: a "camera" group with Director + Camera Crew (2 slots),
// then an ungrouped Producer position.
const positions: TeamPosition[] = [
  position("director", "Director", "camera"),
  position("crew", "Camera Crew", "camera"),
  position("producer", "Producer"),
];
const teamPositionIds = positions.map((p) => p.positionId);
const requirements: PositionRequirement[] = [
  { positionId: "director", count: 1 },
  { positionId: "crew", count: 2 },
  { positionId: "producer", count: 1 },
];
const columns = buildScheduleColumns({
  occurrences: [{ occurrenceId: "occ-1" }],
  requirementsByOccurrence: new Map([["occ-1", requirements]]),
  positions,
  teamPositionIds,
});

const members = [
  member("m-dir", "Jahlani"),
  member("m-a", "Kevin"),
  member("m-b", "David"),
  member("m-prod", "Brandon"),
  member("m-shadow", "Sam"),
];

describe("buildOccurrenceSummaryGroups", () => {
  it("aggregates members across slots and groups by position group", () => {
    const assignmentsRow = {
      [makeSlotKey("director", 0)]: cell("m-dir"),
      [makeSlotKey("crew", 0)]: cell("m-a"),
      [makeSlotKey("crew", 1)]: cell("m-b"),
      [makeSlotKey("producer", 0)]: cell("m-prod"),
    };
    const groups = buildOccurrenceSummaryGroups({
      columns,
      requirements,
      assignmentsRow,
      members,
      duplicateFirstNames: new Set(),
    });

    // Camera group (Director + Camera Crew) then a solo Producer group.
    expect(groups).toHaveLength(2);
    expect(groups[0].positions.map((p) => p.name)).toEqual([
      "Director",
      "Camera Crew",
    ]);
    expect(groups[1].positions.map((p) => p.name)).toEqual(["Producer"]);

    const crew = groups[0].positions[1];
    expect(crew.members.map((m) => m.name)).toEqual(["Kevin", "David"]);
  });

  it("includes required positions with no assignment", () => {
    const groups = buildOccurrenceSummaryGroups({
      columns,
      requirements,
      assignmentsRow: { [makeSlotKey("director", 0)]: cell("m-dir") },
      members,
      duplicateFirstNames: new Set(),
    });
    const crew = groups[0].positions[1];
    expect(crew.members).toEqual([]);
  });

  it("places primaries before shadows and tags shadow kind", () => {
    const assignmentsRow = {
      [makeSlotKey("director", 0)]: cell("m-dir", [
        { memberId: "m-shadow", kind: "shadow" },
      ]),
    };
    const groups = buildOccurrenceSummaryGroups({
      columns,
      requirements,
      assignmentsRow,
      members,
      duplicateFirstNames: new Set(),
    });
    const director = groups[0].positions[0];
    expect(director.members).toEqual([
      { memberId: "m-dir", name: "Jahlani", kind: "primary" },
      { memberId: "m-shadow", name: "Sam", kind: "shadow" },
    ]);
  });

  it("skips positions the occurrence does not require", () => {
    const groups = buildOccurrenceSummaryGroups({
      columns,
      requirements: [{ positionId: "director", count: 1 }],
      assignmentsRow: {},
      members,
      duplicateFirstNames: new Set(),
    });
    const names = groups.flatMap((g) => g.positions.map((p) => p.name));
    expect(names).toEqual(["Director"]);
  });
});

describe("formatOccurrenceMessage", () => {
  it("renders a WhatsApp-friendly message with one blank line after the title", () => {
    const assignmentsRow = {
      [makeSlotKey("director", 0)]: cell("m-dir"),
      [makeSlotKey("crew", 0)]: cell("m-a"),
      [makeSlotKey("crew", 1)]: cell("m-b"),
      // producer intentionally unassigned
    };
    const groups = buildOccurrenceSummaryGroups({
      columns,
      requirements,
      assignmentsRow,
      members,
      duplicateFirstNames: new Set(),
    });
    const message = formatOccurrenceMessage({
      startsAt: "2026-05-30T14:00:00.000Z",
      groups,
    });

    expect(message).toBe(
      [
        "Schedule for May 30, 2026",
        "",
        "Director: Jahlani",
        "Camera Crew: Kevin, David",
        "Producer: TBD",
      ].join("\n"),
    );
  });
});
