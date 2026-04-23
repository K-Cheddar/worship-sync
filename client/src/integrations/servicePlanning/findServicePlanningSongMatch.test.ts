import type { ServiceItem } from "../../types";
import {
  findBestServicePlanningSongMatch,
  getServicePlanningSongMatchScore,
} from "./findServicePlanningSongMatch";

const makeSong = (name: string, id = name): ServiceItem => ({
  _id: id,
  name,
  listId: "list-1",
  type: "song",
});

describe("findServicePlanningSongMatch", () => {
  it("matches titles with trailing hymn numbers and keys to bare song titles", () => {
    const match = findBestServicePlanningSongMatch(
      "To God Be the Glory Hymn #341 (F)",
      [makeSong("To God Be the Glory"), makeSong("Amazing Grace")],
    );

    expect(match?._id).toBe("To God Be the Glory");
  });

  it("matches titles with trailing hymn numbers to numbered library titles", () => {
    const match = findBestServicePlanningSongMatch(
      "To God Be the Glory Hymn #341 (F)",
      [makeSong("341\u2013To God Be the Glory"), makeSong("141\u2013Other Song")],
    );

    expect(match?._id).toBe("341\u2013To God Be the Glory");
  });

  it("scores cleaned library titles higher than unrelated songs", () => {
    const matchScore = getServicePlanningSongMatchScore(
      "To God Be the Glory Hymn #341 (F)",
      "341\u2013To God Be the Glory",
    );
    const otherScore = getServicePlanningSongMatchScore(
      "To God Be the Glory Hymn #341 (F)",
      "Blessed Assurance",
    );

    expect(matchScore).toBeGreaterThan(otherScore);
  });
});
