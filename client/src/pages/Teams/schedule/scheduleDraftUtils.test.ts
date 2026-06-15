import type {
  TeamSchedule,
  TeamScheduleAssignments,
  TeamScheduleOccurrence,
} from "../../../api/authTypes";
import {
  buildScheduleCopyDraft,
  remapAssignmentsToOccurrences,
} from "./scheduleDraftUtils";

const occurrence = (
  serviceId: string,
  startsAt: string,
): TeamScheduleOccurrence => ({
  occurrenceId: `${serviceId}@${startsAt}`,
  serviceId,
  name: serviceId,
  startsAt,
});

const cell = (memberId: string) => ({ primaryMemberId: memberId });

describe("remapAssignmentsToOccurrences", () => {
  it("returns an empty map when there are no assignments", () => {
    expect(
      remapAssignmentsToOccurrences({
        sourceOccurrences: [occurrence("s1", "2026-01-04T10:00:00.000Z")],
        targetOccurrences: [occurrence("s1", "2026-02-01T10:00:00.000Z")],
        assignments: {},
      }),
    ).toEqual({});
  });

  it("shifts assignments onto the matching occurrence index when dates move", () => {
    const jan4 = occurrence("s1", "2026-01-04T10:00:00.000Z");
    const jan11 = occurrence("s1", "2026-01-11T10:00:00.000Z");
    const feb1 = occurrence("s1", "2026-02-01T10:00:00.000Z");
    const feb8 = occurrence("s1", "2026-02-08T10:00:00.000Z");

    const assignments: TeamScheduleAssignments = {
      [jan4.occurrenceId]: { keys: cell("m1") },
      [jan11.occurrenceId]: { keys: cell("m2") },
    };

    expect(
      remapAssignmentsToOccurrences({
        sourceOccurrences: [jan4, jan11],
        targetOccurrences: [feb1, feb8],
        assignments,
      }),
    ).toEqual({
      [feb1.occurrenceId]: { keys: cell("m1") },
      [feb8.occurrenceId]: { keys: cell("m2") },
    });
  });

  it("keeps assignments unchanged for an identity remap (copy with same dates)", () => {
    const jan4 = occurrence("s1", "2026-01-04T10:00:00.000Z");
    const assignments: TeamScheduleAssignments = {
      [jan4.occurrenceId]: { keys: cell("m1") },
    };

    expect(
      remapAssignmentsToOccurrences({
        sourceOccurrences: [jan4],
        targetOccurrences: [jan4],
        assignments,
      }),
    ).toEqual(assignments);
  });

  it("drops source occurrences that have no target counterpart", () => {
    const jan4 = occurrence("s1", "2026-01-04T10:00:00.000Z");
    const jan11 = occurrence("s1", "2026-01-11T10:00:00.000Z");
    const feb1 = occurrence("s1", "2026-02-01T10:00:00.000Z");

    const assignments: TeamScheduleAssignments = {
      [jan4.occurrenceId]: { keys: cell("m1") },
      [jan11.occurrenceId]: { keys: cell("m2") },
    };

    expect(
      remapAssignmentsToOccurrences({
        sourceOccurrences: [jan4, jan11],
        targetOccurrences: [feb1],
        assignments,
      }),
    ).toEqual({
      [feb1.occurrenceId]: { keys: cell("m1") },
    });
  });

  it("matches by chronological order regardless of input order", () => {
    const jan4 = occurrence("s1", "2026-01-04T10:00:00.000Z");
    const jan11 = occurrence("s1", "2026-01-11T10:00:00.000Z");
    const feb1 = occurrence("s1", "2026-02-01T10:00:00.000Z");
    const feb8 = occurrence("s1", "2026-02-08T10:00:00.000Z");

    const assignments: TeamScheduleAssignments = {
      [jan4.occurrenceId]: { keys: cell("first") },
      [jan11.occurrenceId]: { keys: cell("second") },
    };

    expect(
      remapAssignmentsToOccurrences({
        // Deliberately reversed input order.
        sourceOccurrences: [jan11, jan4],
        targetOccurrences: [feb8, feb1],
        assignments,
      }),
    ).toEqual({
      [feb1.occurrenceId]: { keys: cell("first") },
      [feb8.occurrenceId]: { keys: cell("second") },
    });
  });

  it("keeps each service's occurrences independent", () => {
    const aJan = occurrence("sA", "2026-01-04T10:00:00.000Z");
    const bJan = occurrence("sB", "2026-01-04T18:00:00.000Z");
    const aFeb = occurrence("sA", "2026-02-01T10:00:00.000Z");
    const bFeb = occurrence("sB", "2026-02-01T18:00:00.000Z");

    const assignments: TeamScheduleAssignments = {
      [aJan.occurrenceId]: { keys: cell("a") },
      [bJan.occurrenceId]: { keys: cell("b") },
    };

    expect(
      remapAssignmentsToOccurrences({
        sourceOccurrences: [aJan, bJan],
        targetOccurrences: [aFeb, bFeb],
        assignments,
      }),
    ).toEqual({
      [aFeb.occurrenceId]: { keys: cell("a") },
      [bFeb.occurrenceId]: { keys: cell("b") },
    });
  });
});

describe("buildScheduleCopyDraft", () => {
  const source: TeamSchedule = {
    scheduleId: "sch1",
    churchId: "church1",
    name: "January Worship",
    description: "Main team",
    teamId: "team1",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    serviceIds: ["s1"],
    occurrences: [occurrence("s1", "2026-01-04T10:00:00.000Z")],
    assignments: {
      "s1@2026-01-04T10:00:00.000Z": { keys: cell("m1") },
    },
    attendance: {
      "s1@2026-01-04T10:00:00.000Z": {
        m1: { status: "present" },
      },
    },
  };

  it("prefixes the name and carries team, services, dates, and assignments", () => {
    const draft = buildScheduleCopyDraft({
      source,
      occurrences: source.occurrences || [],
    });

    expect(draft.name).toBe("Copy of January Worship");
    expect(draft.teamId).toBe("team1");
    expect(draft.serviceIds).toEqual(["s1"]);
    expect(draft.startDate).toBe("2026-01-01");
    expect(draft.endDate).toBe("2026-01-31");
    expect(draft.assignments).toEqual(source.assignments);
  });

  it("does not carry attendance into the copy", () => {
    const draft = buildScheduleCopyDraft({
      source,
      occurrences: source.occurrences || [],
    });

    expect(draft.attendance).toEqual({});
  });
});
