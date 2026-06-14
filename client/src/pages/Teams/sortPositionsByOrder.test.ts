import type { TeamPosition } from "../../api/authTypes";
import { sortPositionsByOrder } from "./teamsUtils";

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
