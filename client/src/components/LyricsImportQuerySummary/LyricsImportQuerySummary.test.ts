import { buildLyricsImportQueryEntries } from "./LyricsImportQuerySummary";

describe("buildLyricsImportQueryEntries", () => {
  it("includes primary, artist, and album when provided", () => {
    expect(
      buildLyricsImportQueryEntries({
        primaryLabel: "Title",
        primaryValue: "  Amazing Grace  ",
        artist: " Trad ",
        album: " Hymns ",
      }),
    ).toEqual([
      { label: "Title", value: "Amazing Grace" },
      { label: "Artist", value: "Trad" },
      { label: "Album", value: "Hymns" },
    ]);
  });

  it("omits artist and album when empty or whitespace", () => {
    expect(
      buildLyricsImportQueryEntries({
        primaryLabel: "Name",
        primaryValue: "Song",
        artist: "   ",
        album: "",
      }),
    ).toEqual([{ label: "Name", value: "Song" }]);
  });
});
