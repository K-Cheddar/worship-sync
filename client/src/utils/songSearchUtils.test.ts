import {
  filterAndSortSongsForSearch,
  computeSongSearchEnrichment,
  filterAndSortItemsForSearch,
  getSearchHighlightRanges,
} from "./songSearchUtils";
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

  it("finds songs by artist metadata", () => {
    const match = baseSong({
      _id: "artist-match",
      name: "A Quiet Hymn",
      songMetadata: {
        artistName: "The Harbor Choir",
      } as DBItem["songMetadata"],
    });
    const result = filterAndSortSongsForSearch([match], "harbor choir");
    expect(result.map((song) => song._id)).toEqual(["artist-match"]);
  });

  it("ranks a whole-word title match above an embedded partial match", () => {
    const wholeWord = baseSong({ _id: "whole", name: "Owe You Praise" });
    const embedded = baseSong({ _id: "embedded", name: "Power in the Blood" });

    const result = filterAndSortSongsForSearch([embedded, wholeWord], "owe");

    expect(result.map((song) => song._id)).toEqual(["whole", "embedded"]);
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

  it("ranks comparable exact title-word evidence above a content word", () => {
    const titleHit = baseSong({
      _id: "title",
      // Alphabetically last so score-only ranking would bury it when tied.
      name: "Z Sunday Service",
    });
    const contentOnly = baseSong({
      _id: "content",
      name: "Announcements",
      arrangements: [
        {
          id: "arr",
          name: "Default",
          formattedLyrics: [
            {
              id: "s1",
              type: "Verse",
              name: "V1",
              words: "Welcome to our service this morning",
              slideSpan: 1,
            },
          ],
          songOrder: [],
          slides: [],
        },
      ],
    });

    const result = filterAndSortSongsForSearch(
      [contentOnly, titleHit],
      "service",
    );

    expect(result.map((song) => song._id)).toEqual(["title", "content"]);
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

const arrangement = (...words: string[]): DBItem["arrangements"][number] => ({
  id: "arr",
  name: "Default",
  songOrder: [],
  slides: [],
  formattedLyrics: words.map((words, i) => ({
    id: String(i),
    type: "Verse",
    name: `V${i}`,
    words,
    slideSpan: 1,
  })),
});
const lyricSong = (id: string, ...words: string[]) =>
  baseSong({
    _id: id,
    name: id,
    arrangements: [arrangement(...words)],
  });
const ids = (songs: DBItem[], query: string) =>
  filterAndSortSongsForSearch(songs, query).map((song) => song._id);

describe("shared manual relevance", () => {
  it("puts exact titles first and exact lyric phrases above weak titles", () => {
    const phrase = lyricSong(
      "Amazing Grace",
      "Amazing grace, how sweet the sound that saved a wretch like me",
    );
    const weak = baseSong({ _id: "weak", name: "Sound of Praise" });
    const exact = baseSong({ _id: "exact", name: "How Sweet the Sound" });
    expect(ids([weak, phrase, exact], "how sweet the sound")).toEqual([
      "exact",
      "Amazing Grace",
      "weak",
    ]);
    expect(
      computeSongSearchEnrichment(phrase, "how sweet the sound").showWords,
    ).toBe(true);
  });

  it("favors full coverage, concentrated phrases, then scattered coverage", () => {
    const partial = lyricSong("partial", "sweet");
    const scattered = lyricSong("scattered", "sound", "sweet");
    const concentrated = lyricSong("concentrated", "sweet sound");
    expect(ids([partial, scattered, concentrated], "sweet sound")).toEqual([
      "concentrated",
      "scattered",
      "partial",
    ]);
    expect(ids([partial, scattered, concentrated], "sound sweet")).toEqual([
      "concentrated",
      "scattered",
      "partial",
    ]);
  });

  it("boosts order and proximity without counting repetitions", () => {
    const ordered = lyricSong("z", "how sweet the sound");
    const reversed = lyricSong("a", "sound the sweet how");
    const distant = lyricSong(
      "b",
      "sound follows many other words before sweet",
    );
    expect(ids([reversed, ordered, distant], "sweet sound")).toEqual([
      "z",
      "a",
      "b",
    ]);
    const repeated = lyricSong(
      "repeat",
      "sweet sweet with many words before sound",
    );
    expect(
      computeSongSearchEnrichment(repeated, "sweet sweet sound").matchRank,
    ).toBeLessThanOrEqual(
      computeSongSearchEnrichment(repeated, "sweet sound").matchRank,
    );
    const once = computeSongSearchEnrichment(ordered, "sweet sound").matchRank;
    expect(
      computeSongSearchEnrichment(
        {
          ...ordered,
          arrangements: [
            arrangement("how sweet the sound", "how sweet the sound"),
          ],
        },
        "sweet sound",
      ).matchRank,
    ).toBe(once);
    expect(
      computeSongSearchEnrichment(ordered, "sweet sweet sound").matchRank,
    ).toBeLessThanOrEqual(once);
  });

  it.each([
    ["amzing grace", "Amazing Grace"],
    ["how graet thou art", "How Great Thou Art"],
    ["sheperd", "Shepherd"],
    ["halleluja", "Hallelujah"],
    ["holy spirt", "Holy Spirit"],
    ["greta are you lord", "Great Are You Lord"],
    ["amazinng grace", "Amazing Grace"],
    ["amazing grxce", "Amazing Grace"],
  ])("retrieves title and lyric typos: %s", (query, title) => {
    const titleSong = baseSong({ _id: "title", name: title });
    const lyrics = lyricSong("lyrics", title);
    expect(ids([titleSong], query)).toEqual(["title"]);
    expect(ids([lyrics], query)).toEqual(["lyrics"]);
    const wordCount = title.split(/\s+/).length;
    expect(
      computeSongSearchEnrichment(titleSong, query).titleMatch,
    ).toBeGreaterThan((wordCount - 1) / wordCount);
    expect(getSearchHighlightRanges(title, query)).toHaveLength(wordCount);
  });

  it("puts comparable exact evidence above fuzzy evidence", () => {
    expect(
      ids([lyricSong("a", "shepherd"), lyricSong("z", "sheperd")], "sheperd"),
    ).toEqual(["z", "a"]);
  });

  it("rejects short/common fuzzy words and weak fuzzy-only partial queries", () => {
    expect(ids([lyricSong("x", "cat of the by")], "bat")).toEqual([]);
    expect(ids([lyricSong("x", "of the")], "the shepherd")).toEqual([]);
    expect(ids([lyricSong("x", "shepherd")], "sheperd purple ocean")).toEqual(
      [],
    );
    expect(ids([lyricSong("x", "and")], "anx")).toEqual([]);
    expect(ids([lyricSong("x", "the")], "the")).toEqual(["x"]);
  });

  it("searches unselected arrangements and combines their coverage without inventing phrases", () => {
    const song = baseSong({
      _id: "across",
      name: "Obscure",
      selectedArrangement: 0,
      arrangements: [arrangement("shepherd"), arrangement("the quiet valley")],
    });
    const phrase = lyricSong("phrase", "shepherd valley");
    expect(ids([song, phrase], "shepherd valley")).toEqual([
      "phrase",
      "across",
    ]);
    expect(computeSongSearchEnrichment(song, "quiet valley").matchedWords).toBe(
      "the quiet valley",
    );
  });

  it("keeps excerpts current as the query and immutable document change", () => {
    const song = lyricSong("x", "quiet valley", "joyful ocean");
    expect(computeSongSearchEnrichment(song, "valley").matchedWords).toBe(
      "quiet valley",
    );
    expect(computeSongSearchEnrichment(song, "ocean").matchedWords).toBe(
      "joyful ocean",
    );
    const changed = { ...song, arrangements: [arrangement("morning sunrise")] };
    expect(ids([changed], "valley")).toEqual([]);
    expect(ids([changed], "sunrise")).toEqual(["x"]);
  });

  it("retains indexed titles before hydration without claiming lyrics", () => {
    const index = [{ _id: "x", name: "Amazing Grace", type: "song" }];
    const [result] = filterAndSortItemsForSearch(index, [], "amzing grace");
    expect(result._id).toBe("x");
    expect(result.matchedWords).toBe("");
    expect(result.showWords).toBe(false);
    expect(filterAndSortItemsForSearch(index, [], "sweet sound")).toEqual([]);
    expect(
      filterAndSortItemsForSearch(
        index,
        [lyricSong("x", "sweet sound")],
        "sweet sound",
      ),
    ).toHaveLength(1);
  });

  it("uses IDs and types for custom slide text even with duplicate names", () => {
    const first = baseSong({
      _id: "a",
      name: "Announcements",
      type: "free",
      slides: [{ boxes: [{ words: "community lunch" }] }] as DBItem["slides"],
    });
    const second = baseSong({
      _id: "b",
      name: "Announcements",
      type: "free",
      slides: [{ boxes: [{ words: "volunteer meeting" }] }] as DBItem["slides"],
    });
    const items = [first, second].map(({ _id, name, type }) => ({
      _id,
      name,
      type,
    }));
    expect(
      filterAndSortItemsForSearch(items, [second, first], "community").map(
        (row) => row._id,
      ),
    ).toEqual(["a"]);
    expect(
      filterAndSortItemsForSearch(
        items,
        [second, first],
        "volunteer",
        "free",
      ).map((row) => row._id),
    ).toEqual(["b"]);
    expect(
      filterAndSortItemsForSearch(
        [{ ...items[0], type: "song" }],
        [first],
        "community",
      ),
    ).toEqual([]);
  });

  it("shares ordering between song and item adapters and filters without rescoring", () => {
    const songs = [
      baseSong({ _id: "weak", name: "Sound" }),
      lyricSong("Amazing Grace", "how sweet the sound"),
    ];
    const timer = {
      _id: "timer",
      name: "How sweet the sound timer",
      type: "timer",
    };
    const generic = filterAndSortItemsForSearch(
      [...songs, timer],
      songs,
      "how sweet the sound",
    );
    const songOnly = filterAndSortItemsForSearch(
      [...songs, timer],
      songs,
      "how sweet the sound",
      "song",
    );
    expect(songOnly.map((row) => row._id)).toEqual(
      ids(songs, "how sweet the sound"),
    );
    expect(generic.filter((row) => row.type === "song")).toEqual(songOnly);
    expect(filterAndSortItemsForSearch([timer], [], "sweet")).toHaveLength(1);
  });

  it("normalizes punctuation, apostrophes, newlines, case, and typing prefixes consistently", () => {
    const text = "SHEPHERD\u2019S\nquiet-valley";
    const song = lyricSong("x", text);
    expect(ids([song], "shepherds quiet val")).toEqual(["x"]);
    expect(
      getSearchHighlightRanges(text, "shepherds quiet val").map((range) =>
        text.slice(range.start, range.end),
      ),
    ).toEqual(["SHEPHERD\u2019S", "quiet", "valley"]);
    expect(getSearchHighlightRanges("far away shepherd", "shep")).toEqual([
      { start: 9, end: 17, quality: 0.85 },
    ]);
    expect(getSearchHighlightRanges("cat", "bat")).toEqual([]);
  });

  it("has stable alphabetical and ID tie breaks, including empty/punctuation queries", () => {
    const songs = [baseSong({ _id: "z" }), baseSong({ _id: "a" })];
    expect(ids(songs, "")).toEqual(["a", "z"]);
    expect(ids(songs, "!!!")).toEqual(["a", "z"]);
    expect(ids(songs, "amazing")).toEqual(["a", "z"]);
    expect(ids([...songs].reverse(), "amazing")).toEqual(["a", "z"]);
  });
});

it("reuses normalized lyrics across queries and new arrays, refreshing on document replacement", () => {
  const song = lyricSong("cached", "my shepherd");
  const readWords = jest.fn(() => "my shepherd");
  Object.defineProperty(song.arrangements[0].formattedLyrics[0], "words", {
    get: readWords,
  });
  expect(ids([song], "sheperd")).toEqual(["cached"]);
  expect(ids([song], "shepherd")).toEqual(["cached"]);
  expect(readWords).toHaveBeenCalledTimes(1);
  expect(ids([{ ...song }], "shepherd")).toEqual(["cached"]);
  expect(readWords).toHaveBeenCalledTimes(2);
});
