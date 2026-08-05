import {
  bibleRefToSearchString,
  parseBibleReference,
} from "./parseBibleReference";

describe("parseBibleReference", () => {
  it("parses space-separated verse ranges with a trailing version", () => {
    expect(parseBibleReference("Psalm 78 40-64 NKJV")).toEqual({
      book: "Psalms",
      chapter: "78",
      verseRange: "40-64",
      version: "NKJV",
    });
  });

  it("reads a parenthesized version", () => {
    expect(parseBibleReference("Psalms 90 (NLT)")).toEqual({
      book: "Psalms",
      chapter: "90",
      verseRange: "",
      version: "NLT",
    });

    expect(parseBibleReference("John 3:16-18 (ESV)")).toEqual({
      book: "John",
      chapter: "3",
      verseRange: "16-18",
      version: "ESV",
    });
  });

  it("drops a leading label and a non-version parenthetical", () => {
    expect(parseBibleReference("Scripture: Psalm 23")).toEqual({
      book: "Psalms",
      chapter: "23",
      verseRange: "",
      version: "",
    });

    expect(parseBibleReference("Reading — John 3:16 NKJV")).toEqual({
      book: "John",
      chapter: "3",
      verseRange: "16",
      version: "NKJV",
    });

    expect(parseBibleReference("Psalm 23 (read by Ana)")).toEqual({
      book: "Psalms",
      chapter: "23",
      verseRange: "",
      version: "",
    });
  });

  it("resolves abbreviated book names to their canonical spelling", () => {
    expect(parseBibleReference("Ps. 121:1-2")).toEqual({
      book: "Psalms",
      chapter: "121",
      verseRange: "1-2",
      version: "",
    });

    expect(parseBibleReference("1Cor 13:1-13")).toEqual({
      book: "1 Corinthians",
      chapter: "13",
      verseRange: "1-13",
      version: "",
    });
  });

  it("rejects titles that only look like a reference", () => {
    expect(parseBibleReference("Welcome 5")).toBeNull();
    expect(parseBibleReference("Offering")).toBeNull();
    expect(parseBibleReference("Hymn 341")).toBeNull();
  });

  it("keeps colon-separated references working", () => {
    expect(parseBibleReference("1 Corinthians 13:1-13 KJV")).toEqual({
      book: "1 Corinthians",
      chapter: "13",
      verseRange: "1-13",
      version: "KJV",
    });
  });

  it("parses v-style verse separators", () => {
    expect(parseBibleReference("Psalms 119 v 23 NKJV")).toEqual({
      book: "Psalms",
      chapter: "119",
      verseRange: "23",
      version: "NKJV",
    });
  });

  it("builds Bible search strings from parsed references", () => {
    const ref = parseBibleReference("Psalm 78 40-64 NKJV");

    expect(ref && bibleRefToSearchString(ref)).toBe("Psalms 78:40-64");
  });
});
