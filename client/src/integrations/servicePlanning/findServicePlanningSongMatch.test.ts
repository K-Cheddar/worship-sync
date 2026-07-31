import type { ServiceItem } from "../../types";
import {
  findBestServicePlanningSongMatch,
  findSongMatchSuggestions,
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

  it("does not match when only a trailing common phrase overlaps", () => {
    const match = findBestServicePlanningSongMatch("Joy is Coming", [
      makeSong("The Lord is Coming"),
      makeSong("Great Is Thy Faithfulness"),
    ]);

    expect(match).toBeNull();
  });

  it.each([
    ["Oh How I Love Jesus", "O How I Love Jesus"],
    ["Great Is Your Faithfulness", "Great Is Thy Faithfulness"],
    ["How Great Is Our God (Live)", "How Great Is Our God"],
    ["Pass Me Not O Gentle Saviour", "Pass Me Not, O Gentle Savior"],
    ["He Hideth My Soul 520", "He Hideth My Soul"],
    ["10000 Reasons", "10,000 Reasons (Bless the Lord)"],
  ])("matches %s to %s", (planningTitle, expected) => {
    const match = findBestServicePlanningSongMatch(planningTitle, [
      makeSong("O How I Love Jesus"),
      makeSong("Great Is Thy Faithfulness"),
      makeSong("How Great Is Our God"),
      makeSong("Pass Me Not, O Gentle Savior"),
      makeSong("He Hideth My Soul"),
      makeSong("10,000 Reasons (Bless the Lord)"),
      makeSong("Amazing Grace"),
    ]);

    expect(match?._id).toBe(expected);
  });

  it("does not link a title to a song that merely shares its words", () => {
    // Reported from a real plan: "Owe You Praise" auto-linked to a song whose
    // name held "praise" and "you". Word overlap is not enough on its own.
    const match = findBestServicePlanningSongMatch("Owe You Praise", [
      makeSong("Praise You"),
      makeSong("I Will Praise You"),
      makeSong("Praise You in This Storm"),
      makeSong("We Praise You"),
      makeSong("You Deserve the Praise"),
    ]);

    expect(match).toBeNull();
  });

  it("still links a title that only continues a library song's name", () => {
    const match = findBestServicePlanningSongMatch("Praise You (Live)", [
      makeSong("Praise You"),
      makeSong("I Will Praise You"),
    ]);

    expect(match?._id).toBe("Praise You");
  });

  it("leaves the song unlinked when two library songs are equally close", () => {
    // Neither is the song, and picking one would put the wrong lyrics on
    // screen — an unlinked chip is the safer answer.
    const match = findBestServicePlanningSongMatch("Come Thou Almighty", [
      makeSong("Come Thou Almighty King"),
      makeSong("Come Thou Almighty Lord"),
    ]);

    expect(match).toBeNull();
  });

  it("takes an exact title over a near-duplicate in the library", () => {
    const match = findBestServicePlanningSongMatch("Trust in God", [
      makeSong("Trust in God (Live)"),
      makeSong("Trust in God"),
    ]);

    expect(match?._id).toBe("Trust in God");
  });

  describe("findSongMatchSuggestions", () => {
    it("ranks the near-misses closest first", () => {
      const suggestions = findSongMatchSuggestions("Rolled the Sea Away", [
        makeSong("Amazing Grace"),
        makeSong("Rolled Away"),
        makeSong("Rolled the Sea Away Again"),
      ]);

      expect(suggestions.map(({ song }) => song._id)).toEqual([
        "Rolled the Sea Away Again",
        "Rolled Away",
      ]);
    });

    it("offers both songs when neither could be chosen automatically", () => {
      const songs = [
        makeSong("Come Thou Almighty King"),
        makeSong("Come Thou Almighty Lord"),
      ];

      expect(findBestServicePlanningSongMatch("Come Thou Almighty", songs)).toBeNull();
      expect(findSongMatchSuggestions("Come Thou Almighty", songs)).toHaveLength(2);
    });

    it("offers nothing for a title with no relation to the library", () => {
      expect(
        findSongMatchSuggestions("Way Maker", [
          makeSong("Amazing Grace"),
          makeSong("Great Is Thy Faithfulness"),
        ]),
      ).toEqual([]);
    });

    it("keeps the words-in-common false positive out of the suggestions", () => {
      // "Owe You Praise" must not link to these, but they are the right things
      // to offer someone who is choosing by hand.
      const suggestions = findSongMatchSuggestions("Owe You Praise", [
        makeSong("Praise You"),
        makeSong("Amazing Grace"),
      ]);

      expect(suggestions.map(({ song }) => song._id)).toEqual(["Praise You"]);
    });
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
