import { cleanPlanningTitle } from "./cleanPlanningTitle";

describe("cleanPlanningTitle", () => {
  it.each([
    ["There's a Welcome Here (C)", "There's a Welcome Here"],
    ["Shall Not Want (Eb→F)", "Shall Not Want"],
    ["Hymn 499 - Rolled the Sea Away", "Rolled the Sea Away"],
    ["341-To God Be the Glory", "To God Be the Glory"],
    ["To God Be the Glory Hymn #341", "To God Be the Glory"],
    // The printout prints the hymnal number on its own, without "Hymn".
    ["He Hideth My Soul #520 (Bb)", "He Hideth My Soul"],
    ["Pass Me Not, O Gentle Savior #569 (Eb)", "Pass Me Not, O Gentle Savior"],
  ])("cleans %s", (raw, expected) => {
    expect(cleanPlanningTitle(raw)).toBe(expected);
  });

  it("leaves a title that carries no printout decoration alone", () => {
    expect(cleanPlanningTitle("How Great is Our God")).toBe("How Great is Our God");
  });
});
