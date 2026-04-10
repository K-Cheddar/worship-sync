import { filterAndSortSongsForSearch, computeSongSearchEnrichment } from "./songSearchUtils";
import { DBItem } from "../types";

const baseSong = (overrides: Partial<DBItem> = {}): DBItem =>
  ({
    _id: "id",
    name: "Amazing Grace",
    type: "song",
    selectedArrangement: 0,
    shouldSendTo: { projector: true, monitor: true, stream: true },
    slides: [],
    arrangements: [],
    ...overrides,
  }) as DBItem;

describe("songSearchUtils", () => {
  it("sorts alphabetically when search is empty", () => {
    const a = baseSong({ _id: "a", name: "Zebra Song" });
    const b = baseSong({ _id: "b", name: "Alpha Tune" });
    const sorted = filterAndSortSongsForSearch([a, b], "");
    expect(sorted.map((s) => s.name)).toEqual(["Alpha Tune", "Zebra Song"]);
  });

  it("finds songs by title using the same ranking as FilteredItems", () => {
    const match = baseSong({ _id: "m", name: "Evening Praise" });
    const other = baseSong({ _id: "o", name: "Morning Song" });
    const result = filterAndSortSongsForSearch([other, match], "evening");
    expect(result.map((s) => s._id)).toEqual(["m"]);
  });

  it("finds songs by lyric content across arrangements", () => {
    const withLyric = baseSong({
      _id: "lyric",
      name: "Obscure Title",
      arrangements: [
        {
          id: "arr",
          name: "Default",
          formattedLyrics: [
            {
              id: "s1",
              type: "Verse",
              name: "V1",
              words: "The Lord is my shepherd I shall not want",
              slideSpan: 1,
            },
          ],
          songOrder: [],
          slides: [],
        },
      ],
    });
    const other = baseSong({ _id: "other", name: "Other Song" });
    const result = filterAndSortSongsForSearch([other, withLyric], "shepherd");
    expect(result.map((s) => s._id)).toEqual(["lyric"]);
  });

  it("computeSongSearchEnrichment sets showWords when only lyrics match", () => {
    const song = baseSong({
      arrangements: [
        {
          id: "arr",
          name: "Default",
          formattedLyrics: [
            {
              id: "s1",
              type: "Chorus",
              name: "C",
              words: "Hallelujah forever",
              slideSpan: 1,
            },
          ],
          songOrder: [],
          slides: [],
        },
      ],
    });
    const clean = "hallelujah";
    const enriched = computeSongSearchEnrichment(song, clean);
    expect(enriched.matchRank).toBeGreaterThan(0);
    expect(enriched.showWords).toBe(true);
  });
});
