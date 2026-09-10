import {
  extractPlanningKey,
  formatSongTitleWithKey,
  getServicePlanSongRefLabel,
  hasPlanningKeySuffix,
  libraryServicePlanSongRef,
} from "./formatSongTitleWithKey";

describe("formatSongTitleWithKey", () => {
  it("appends a key when the title does not already have one", () => {
    expect(formatSongTitleWithKey("Great Are You Lord", "G")).toBe(
      "Great Are You Lord (G)",
    );
  });

  it("leaves titles that already end with a key alone", () => {
    expect(formatSongTitleWithKey("Great Are You Lord (G)", "A")).toBe(
      "Great Are You Lord (G)",
    );
  });

  it("extracts trailing planning keys", () => {
    expect(extractPlanningKey("Great Are You Lord (G)")).toBe("G");
    expect(extractPlanningKey("Shall Not Want (Eb→F)")).toBe("Eb→F");
    expect(hasPlanningKeySuffix("Great Are You Lord")).toBe(false);
  });

  it("labels song refs with their key", () => {
    expect(
      getServicePlanSongRefLabel({
        kind: "library",
        songId: "1",
        songName: "Great Are You Lord",
        key: "G",
      }),
    ).toBe("Great Are You Lord (G)");
    expect(
      libraryServicePlanSongRef({
        _id: "1",
        name: "Living Hope",
        songMetadata: { key: "A" },
      }),
    ).toEqual({
      kind: "library",
      songId: "1",
      songName: "Living Hope",
      key: "A",
    });
  });
});
