import type { TeamPosition, TeamRecord } from "../../api/authTypes";
import { orderPositionsByTeamList, sortPositionsByOrder } from "./teamsUtils";

const position = (
  positionId: string,
  order?: number,
): TeamPosition => ({
  positionId,
  churchId: "c",
  teamId: "team-main",
  name: positionId,
  ...(order === undefined ? {} : { order }),
});

describe("sortPositionsByOrder", () => {
  it("orders positions by their explicit order field", () => {
    const sorted = sortPositionsByOrder([
      position("keys", 2),
      position("vocal", 0),
      position("drums", 1),
    ]);
    expect(sorted.map((p) => p.positionId)).toEqual(["vocal", "drums", "keys"]);
  });

  it("places positions without an order after ordered ones, keeping their relative order", () => {
    const sorted = sortPositionsByOrder([
      position("legacy-a"),
      position("ordered", 0),
      position("legacy-b"),
    ]);
    expect(sorted.map((p) => p.positionId)).toEqual([
      "ordered",
      "legacy-a",
      "legacy-b",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [position("keys", 1), position("vocal", 0)];
    const sorted = sortPositionsByOrder(input);
    expect(input.map((p) => p.positionId)).toEqual(["keys", "vocal"]);
    expect(sorted).not.toBe(input);
  });
});

describe("orderPositionsByTeamList", () => {
  const teamA: TeamRecord = {
    teamId: "team-a",
    churchId: "c",
    name: "Team A",
    memberIds: [],
  };
  const teamB: TeamRecord = {
    teamId: "team-b",
    churchId: "c",
    name: "Team B",
    memberIds: [],
  };

  it("orders positions within each team by order and groups teams by the teams list", () => {
    const positions = [
      { ...position("b-keys", 1), teamId: "team-b" },
      { ...position("a-vocal", 1), teamId: "team-a" },
      { ...position("b-vocal", 0), teamId: "team-b" },
      { ...position("a-keys", 0), teamId: "team-a" },
    ];
    const ordered = orderPositionsByTeamList(positions, [teamA, teamB]);
    expect(ordered.map((p) => p.positionId)).toEqual([
      "a-keys",
      "a-vocal",
      "b-vocal",
      "b-keys",
    ]);
  });
});
