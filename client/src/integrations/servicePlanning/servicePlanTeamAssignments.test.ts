import { toServicePlanningTeamAssignments } from "./servicePlanTeamAssignments";
import type { TeamsAssignmentSummaryRow } from "../../pages/Teams/pages/teamsAssignmentsSummary";

const row = (
  overrides: Partial<TeamsAssignmentSummaryRow>,
): TeamsAssignmentSummaryRow => ({
  teamId: "team-1",
  teamName: "Band",
  scheduleId: "schedule-1",
  occurrenceId: "occurrence-1",
  positionId: "position-1",
  positionName: "Keys",
  columnKey: "position-1::0",
  slotLabel: "Keys",
  memberName: "Dana Robinson",
  ...overrides,
});

describe("toServicePlanningTeamAssignments", () => {
  it("maps filled slots to team, role, and name", () => {
    expect(
      toServicePlanningTeamAssignments([
        row({ teamName: "Band", slotLabel: "Keys", memberName: "Dana Robinson" }),
      ]),
    ).toEqual([{ teamName: "Band", role: "Keys", name: "Dana Robinson" }]);
  });

  it("drops required-but-unfilled slots", () => {
    const assignments = toServicePlanningTeamAssignments([
      row({ slotLabel: "Keys", memberName: "Dana Robinson" }),
      row({ slotLabel: "Drums", memberName: null }),
    ]);

    expect(assignments).toEqual([
      { teamName: "Band", role: "Keys", name: "Dana Robinson" },
    ]);
  });

  it("keeps the slot-numbered label so duplicate positions stay distinct", () => {
    const assignments = toServicePlanningTeamAssignments([
      row({ slotLabel: "Vocals 1", memberName: "Sam Lee" }),
      row({ slotLabel: "Vocals 2", memberName: "Alex Kim" }),
    ]);

    expect(assignments.map((assignment) => assignment.role)).toEqual([
      "Vocals 1",
      "Vocals 2",
    ]);
  });

  it("returns nothing when no one is assigned yet", () => {
    expect(
      toServicePlanningTeamAssignments([row({ memberName: null })]),
    ).toEqual([]);
  });
});
