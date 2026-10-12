import type { TeamPosition, TeamRecord, TeamRosterMember } from "../../api/authTypes";
import { getMemberListAssignments } from "./memberListAssignments";

const member: TeamRosterMember = {
  memberId: "member-1",
  churchId: "church-1",
  firstName: "Rae",
  lastName: "Kim",
  positionIds: ["camera-b", "camera-a", "missing-position"],
  teamMemberships: { "team-audio": { teamId: "team-audio" } },
  blockoutDates: [],
};

const teams: TeamRecord[] = [
  { teamId: "team-media", churchId: "church-1", name: "Media", memberIds: [] },
  { teamId: "team-audio", churchId: "church-1", name: "Audio", memberIds: [] },
];

const positions: TeamPosition[] = [
  { positionId: "camera-b", churchId: "church-1", teamId: "team-media", name: "Camera Operator" },
  { positionId: "camera-a", churchId: "church-1", teamId: "team-media", name: "Camera Operator" },
];

describe("getMemberListAssignments", () => {
  it("sorts assignments, removes duplicate labels, and ignores missing references", () => {
    expect(
      getMemberListAssignments(
        member,
        [],
        new Map(teams.map((team) => [team.teamId, team])),
        new Map(positions.map((position) => [position.positionId, position])),
      ),
    ).toEqual([
      { teamId: "team-audio", teamName: "Audio" },
      { teamId: "team-media", teamName: "Media", positionName: "Camera Operator" },
    ]);
  });

  it("includes roster membership alongside its position assignments", () => {
    const memberWithRosterMembership = { ...member, teamMemberships: undefined };
    expect(
      getMemberListAssignments(
        memberWithRosterMembership,
        ["team-audio"],
        new Map(teams.map((team) => [team.teamId, team])),
        new Map(positions.map((position) => [position.positionId, position])),
      ),
    ).toEqual([
      { teamId: "team-audio", teamName: "Audio" },
      { teamId: "team-media", teamName: "Media", positionName: "Camera Operator" },
    ]);
  });
});
