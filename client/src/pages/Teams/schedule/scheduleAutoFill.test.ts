import type {
  TeamPosition,
  TeamQualificationLevel,
  TeamRosterMember,
  TeamScheduleAssignments,
} from "../../../api/authTypes";
import { buildScheduleColumns } from "./scheduleRequirements";
import { buildAutoFillPlan } from "./scheduleAutoFill";

const duplicateFirstNames = new Set<string>();

const member = (
  memberId: string,
  positionIds: string[],
  extra: Partial<TeamRosterMember> = {},
): TeamRosterMember => ({
  memberId,
  churchId: "c1",
  firstName: memberId,
  lastName: "Test",
  positionIds,
  blockoutDates: [],
  ...extra,
});

const position = (positionId: string, extra: Partial<TeamPosition> = {}): TeamPosition => ({
  positionId,
  churchId: "c1",
  teamId: "t1",
  name: positionId,
  ...extra,
});

// A minimal stand-in for ScheduleTab's getAssignmentIssue: checks position
// eligibility and "already assigned elsewhere in this occurrence" against the
// persisted assignments passed in — the same rules the real callback applies,
// without the archived/team-membership/blockout checks this suite doesn't need.
const makeGetAssignmentIssue =
  (members: TeamRosterMember[], assignments: TeamScheduleAssignments) =>
  (memberId: string, occurrenceId: string, positionId: string) => {
    const found = members.find((m) => m.memberId === memberId);
    if (!found) return "Not available";
    if (!found.positionIds.includes(positionId)) return "Not eligible for this position";
    const row = assignments[occurrenceId] || {};
    const assignedElsewhere = Object.values(row).some(
      (cell) => cell?.primaryMemberId === memberId,
    );
    if (assignedElsewhere) return "Already assigned in this service";
    return "";
  };

const noWarning = () => "";

describe("buildAutoFillPlan", () => {
  it("fills empty slots and leaves existing assignments untouched", () => {
    const positions = [position("vocal")];
    const occurrences = [{ occurrenceId: "occ1" }];
    const requirementsByOccurrence = new Map([
      ["occ1", [{ positionId: "vocal", count: 1 }]],
    ]);
    const columns = buildScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal"],
    });
    const members = [member("amy", ["vocal"])];
    const assignments: TeamScheduleAssignments = {};

    const plan = buildAutoFillPlan({
      occurrences,
      columns,
      requirementsByOccurrence,
      assignments,
      members,
      positions,
      qualificationLevels: [],
      duplicateFirstNames,
      getAssignmentIssue: makeGetAssignmentIssue(members, assignments),
      getServiceAvailabilityWarning: noWarning,
      getCrossTeamConflictWarning: noWarning,
    });

    expect(plan.entries).toEqual([
      { occurrenceId: "occ1", columnKey: "vocal::0", positionId: "vocal", memberId: "amy" },
    ]);
    expect(plan.unfilledSlots).toEqual([]);
  });

  it("never overwrites a slot that already has someone assigned", () => {
    const positions = [position("vocal")];
    const occurrences = [{ occurrenceId: "occ1" }];
    const requirementsByOccurrence = new Map([
      ["occ1", [{ positionId: "vocal", count: 1 }]],
    ]);
    const columns = buildScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal"],
    });
    const members = [member("amy", ["vocal"]), member("zane", ["vocal"])];
    const assignments: TeamScheduleAssignments = {
      occ1: { "vocal::0": { primaryMemberId: "zane" } },
    };

    const plan = buildAutoFillPlan({
      occurrences,
      columns,
      requirementsByOccurrence,
      assignments,
      members,
      positions,
      qualificationLevels: [],
      duplicateFirstNames,
      getAssignmentIssue: makeGetAssignmentIssue(members, assignments),
      getServiceAvailabilityWarning: noWarning,
      getCrossTeamConflictWarning: noWarning,
    });

    expect(plan.entries).toEqual([]);
    expect(plan.unfilledSlots).toEqual([]);
  });

  it("spreads assignments across occurrences instead of repeating the same person", () => {
    const positions = [position("vocal")];
    const occurrences = [
      { occurrenceId: "occ1" },
      { occurrenceId: "occ2" },
      { occurrenceId: "occ3" },
    ];
    const requirementsByOccurrence = new Map(
      occurrences.map((o) => [o.occurrenceId, [{ positionId: "vocal", count: 1 }]]),
    );
    const columns = buildScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal"],
    });
    const members = [member("amy", ["vocal"]), member("beth", ["vocal"])];
    const assignments: TeamScheduleAssignments = {};

    const plan = buildAutoFillPlan({
      occurrences,
      columns,
      requirementsByOccurrence,
      assignments,
      members,
      positions,
      qualificationLevels: [],
      duplicateFirstNames,
      getAssignmentIssue: makeGetAssignmentIssue(members, assignments),
      getServiceAvailabilityWarning: noWarning,
      getCrossTeamConflictWarning: noWarning,
    });

    // Fairness alternates the two occurrences 1 and 2; by occurrence 3 both have
    // one assignment each, so spacing (farthest from a person's nearest pick)
    // breaks the tie and avoids putting the same person back-to-back.
    const picks = plan.entries.map((e) => e.memberId);
    expect(picks[0]).not.toBe(picks[1]);
    expect(picks[2]).toBe(picks[0]);
  });

  it("never puts someone back-to-back even when they're far behind on overall fairness", () => {
    const positions = [position("vocal")];
    const occurrences = [{ occurrenceId: "occ1" }, { occurrenceId: "occ2" }];
    const requirementsByOccurrence = new Map([
      ["occ1", [{ positionId: "vocal", count: 1 }]],
      ["occ2", [{ positionId: "vocal", count: 1 }]],
    ]);
    const columns = buildScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal"],
    });
    const members = [member("a", ["vocal"]), member("b", ["vocal"]), member("c", ["vocal"])];
    // b and c each have three prior assignments from occurrences outside this
    // pass's range (old history, so it counts toward fairness but carries no
    // spacing distance), while a has none. Fairness alone would pick a for
    // both occ1 and occ2 back-to-back, since a's count (0, then 1) stays
    // below b/c's (3) the whole time.
    const assignments: TeamScheduleAssignments = {
      old1: { "vocal::0": { primaryMemberId: "b" } },
      old2: { "vocal::0": { primaryMemberId: "b" } },
      old3: { "vocal::0": { primaryMemberId: "b" } },
      old4: { "vocal::0": { primaryMemberId: "c" } },
      old5: { "vocal::0": { primaryMemberId: "c" } },
      old6: { "vocal::0": { primaryMemberId: "c" } },
    };

    const plan = buildAutoFillPlan({
      occurrences,
      columns,
      requirementsByOccurrence,
      assignments,
      members,
      positions,
      qualificationLevels: [],
      duplicateFirstNames,
      getAssignmentIssue: makeGetAssignmentIssue(members, assignments),
      getServiceAvailabilityWarning: noWarning,
      getCrossTeamConflictWarning: noWarning,
    });

    const picks = plan.entries.map((e) => e.memberId);
    expect(picks[0]).toBe("a");
    expect(picks[1]).not.toBe("a");
  });

  it("fills the scarcest position first so a rare position isn't starved", () => {
    const positions = [position("vocal"), position("camera")];
    const occurrences = [{ occurrenceId: "occ1" }];
    const requirementsByOccurrence = new Map([
      ["occ1", [{ positionId: "vocal", count: 1 }, { positionId: "camera", count: 1 }]],
    ]);
    // Team position order lists vocal before camera, so without scarcity-first
    // ordering vocal would be filled first.
    const columns = buildScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal", "camera"],
    });
    // Only "amy" can run camera; both amy and beth can sing, and amy sorts
    // first by name so she'd normally be picked for vocal if it went first.
    const members = [member("amy", ["vocal", "camera"]), member("beth", ["vocal"])];
    const assignments: TeamScheduleAssignments = {};

    const plan = buildAutoFillPlan({
      occurrences,
      columns,
      requirementsByOccurrence,
      assignments,
      members,
      positions,
      qualificationLevels: [],
      duplicateFirstNames,
      getAssignmentIssue: makeGetAssignmentIssue(members, assignments),
      getServiceAvailabilityWarning: noWarning,
      getCrossTeamConflictWarning: noWarning,
    });

    expect(plan.unfilledSlots).toEqual([]);
    expect(plan.entries).toContainEqual({
      occurrenceId: "occ1",
      columnKey: "camera::0",
      positionId: "camera",
      memberId: "amy",
    });
    expect(plan.entries).toContainEqual({
      occurrenceId: "occ1",
      columnKey: "vocal::0",
      positionId: "vocal",
      memberId: "beth",
    });
  });

  it("avoids pairing two lowest-level people on a multi-slot position when a better mix is available", () => {
    const cameraPosition = position("camera", { qualificationAreaId: "area-camera" });
    const positions = [cameraPosition];
    const occurrences = [{ occurrenceId: "occ1" }];
    const requirementsByOccurrence = new Map([
      ["occ1", [{ positionId: "camera", count: 2 }]],
    ]);
    const columns = buildScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["camera"],
    });
    const levels: TeamQualificationLevel[] = [
      { levelId: "l1", churchId: "c1", areaId: "area-camera", name: "Level 1", rank: 1 },
      { levelId: "l2", churchId: "c1", areaId: "area-camera", name: "Level 2", rank: 2 },
    ];
    const members = [
      member("rookie1", ["camera"], {
        qualifications: [{ qualificationId: "q1", areaId: "area-camera", levelId: "l1", status: "completed" }],
      }),
      member("rookie2", ["camera"], {
        qualifications: [{ qualificationId: "q2", areaId: "area-camera", levelId: "l1", status: "completed" }],
      }),
      member("veteran", ["camera"], {
        qualifications: [{ qualificationId: "q3", areaId: "area-camera", levelId: "l2", status: "completed" }],
      }),
    ];
    // camera::0 already has a level-1 person; the other slot is open.
    const assignments: TeamScheduleAssignments = {
      occ1: { "camera::0": { primaryMemberId: "rookie1" } },
    };

    const plan = buildAutoFillPlan({
      occurrences,
      columns,
      requirementsByOccurrence,
      assignments,
      members,
      positions,
      qualificationLevels: levels,
      duplicateFirstNames,
      getAssignmentIssue: makeGetAssignmentIssue(members, assignments),
      getServiceAvailabilityWarning: noWarning,
      getCrossTeamConflictWarning: noWarning,
    });

    expect(plan.entries).toEqual([
      { occurrenceId: "occ1", columnKey: "camera::1", positionId: "camera", memberId: "veteran" },
    ]);
  });

  it("excludes cross-team conflicted members and reports a slot as unfilled with no eligible candidate", () => {
    const positions = [position("vocal")];
    const occurrences = [{ occurrenceId: "occ1" }];
    const requirementsByOccurrence = new Map([
      ["occ1", [{ positionId: "vocal", count: 1 }]],
    ]);
    const columns = buildScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal"],
    });
    const members = [member("amy", ["vocal"])];
    const assignments: TeamScheduleAssignments = {};

    const plan = buildAutoFillPlan({
      occurrences,
      columns,
      requirementsByOccurrence,
      assignments,
      members,
      positions,
      qualificationLevels: [],
      duplicateFirstNames,
      getAssignmentIssue: makeGetAssignmentIssue(members, assignments),
      getServiceAvailabilityWarning: noWarning,
      getCrossTeamConflictWarning: () => "Already scheduled on another team this time.",
    });

    expect(plan.entries).toEqual([]);
    expect(plan.unfilledSlots).toEqual([{ occurrenceId: "occ1", columnKey: "vocal::0" }]);
  });

  it("never silently places someone marked unavailable, even as a last resort", () => {
    const positions = [position("vocal")];
    const occurrences = [{ occurrenceId: "occ1" }];
    const requirementsByOccurrence = new Map([
      ["occ1", [{ positionId: "vocal", count: 1 }]],
    ]);
    const columns = buildScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal"],
    });
    // Amy is the only eligible person for this slot, but marked this service
    // unavailable on intake — a human picking manually would see that warning
    // and could still choose her, but auto-fill has no one to show it to.
    const members = [member("amy", ["vocal"])];
    const assignments: TeamScheduleAssignments = {};

    const plan = buildAutoFillPlan({
      occurrences,
      columns,
      requirementsByOccurrence,
      assignments,
      members,
      positions,
      qualificationLevels: [],
      duplicateFirstNames,
      getAssignmentIssue: makeGetAssignmentIssue(members, assignments),
      getServiceAvailabilityWarning: (memberId) =>
        memberId === "amy" ? "Marked this service unavailable on intake" : "",
      getCrossTeamConflictWarning: noWarning,
    });

    expect(plan.entries).toEqual([]);
    expect(plan.unfilledSlots).toEqual([{ occurrenceId: "occ1", columnKey: "vocal::0" }]);
  });

  it("still fills the slot with a fully-available person when one exists alongside an unavailable one", () => {
    const positions = [position("vocal")];
    const occurrences = [{ occurrenceId: "occ1" }];
    const requirementsByOccurrence = new Map([
      ["occ1", [{ positionId: "vocal", count: 1 }]],
    ]);
    const columns = buildScheduleColumns({
      occurrences,
      requirementsByOccurrence,
      positions,
      teamPositionIds: ["vocal"],
    });
    const members = [member("amy", ["vocal"]), member("beth", ["vocal"])];
    const assignments: TeamScheduleAssignments = {};

    const plan = buildAutoFillPlan({
      occurrences,
      columns,
      requirementsByOccurrence,
      assignments,
      members,
      positions,
      qualificationLevels: [],
      duplicateFirstNames,
      getAssignmentIssue: makeGetAssignmentIssue(members, assignments),
      getServiceAvailabilityWarning: (memberId) =>
        memberId === "amy" ? "Marked this service unavailable on intake" : "",
      getCrossTeamConflictWarning: noWarning,
    });

    expect(plan.entries).toEqual([
      { occurrenceId: "occ1", columnKey: "vocal::0", positionId: "vocal", memberId: "beth" },
    ]);
  });
});
