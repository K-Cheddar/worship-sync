import { extractBibleReferencesFromText } from "./bibleReferenceParser";

describe("extractBibleReferencesFromText", () => {
  it("extracts numbered references with a final global version", () => {
    const rows = extractBibleReferencesFromText(
      `1.\tJohn 8:44
2.\tMatthew 24:4–5
3.\tDaniel 12:1–3 (primary reading)
KJV`,
      "nkjv",
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          book: "John",
          chapter: "8",
          verseRange: "44",
          version: "kjv",
        }),
        expect.objectContaining({
          book: "Matthew",
          chapter: "24",
          verseRange: "4-5",
          version: "kjv",
        }),
        expect.objectContaining({
          book: "Daniel",
          chapter: "12",
          verseRange: "1-3",
          version: "kjv",
          note: "primary reading",
        }),
      ]),
    );
  });

  it("handles labels, semicolons, comma continuations, and global All version", () => {
    const rows = extractBibleReferencesFromText(
      "Main Text: John 14:16–18\n\nOther Texts: John 16:7–13; Acts 1:4–8; Acts 2:1–4; James 5:7–8; Joel 2:23, 28–29\n\nAll NKJV",
      "kjv",
    );

    expect(rows.map(({ book, chapter, verseRange, version }) => ({
      book,
      chapter,
      verseRange,
      version,
    }))).toEqual([
      { book: "John", chapter: "14", verseRange: "16-18", version: "nkjv" },
      { book: "John", chapter: "16", verseRange: "7-13", version: "nkjv" },
      { book: "Acts", chapter: "1", verseRange: "4-8", version: "nkjv" },
      { book: "Acts", chapter: "2", verseRange: "1-4", version: "nkjv" },
      { book: "James", chapter: "5", verseRange: "7-8", version: "nkjv" },
      { book: "Joel", chapter: "2", verseRange: "23", version: "nkjv" },
      { book: "Joel", chapter: "2", verseRange: "28-29", version: "nkjv" },
    ]);
  });

  it("handles spaced colons, inline versions, and notes", () => {
    const rows = extractBibleReferencesFromText(
      `John 15 : 12–15 NKJV
1 Samuel 18 : 1–4 NKJV
Daniel 3 : 25 NKJV (Friend in the furnace)`,
      "kjv",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        book: "John",
        chapter: "15",
        verseRange: "12-15",
        version: "nkjv",
      }),
      expect.objectContaining({
        book: "1 Samuel",
        chapter: "18",
        verseRange: "1-4",
        version: "nkjv",
      }),
      expect.objectContaining({
        book: "Daniel",
        chapter: "3",
        verseRange: "25",
        version: "nkjv",
        note: "Friend in the furnace",
      }),
    ]);
  });

  it("handles abbreviations and dedupes exact repeated references", () => {
    const rows = extractBibleReferencesFromText(
      "Matt 5: 38-48, Romans 12:21, Gen. 9:20–23, Matthew 5:38-48\nNKJV",
      "kjv",
    );

    expect(rows.map(({ book, chapter, verseRange, status }) => ({
      book,
      chapter,
      verseRange,
      status,
    }))).toEqual([
      { book: "Matthew", chapter: "5", verseRange: "38-48", status: "ready" },
      { book: "Romans", chapter: "12", verseRange: "21", status: "ready" },
      { book: "Genesis", chapter: "9", verseRange: "20-23", status: "ready" },
      {
        book: "Matthew",
        chapter: "5",
        verseRange: "38-48",
        status: "duplicate",
      },
    ]);
  });
});
