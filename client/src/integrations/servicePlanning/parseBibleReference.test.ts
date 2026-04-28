import {
  bibleRefToSearchString,
  parseBibleReference,
} from "./parseBibleReference";

describe("parseBibleReference", () => {
  it("parses space-separated verse ranges with a trailing version", () => {
    expect(parseBibleReference("Psalm 78 40-64 NKJV")).toEqual({
      book: "Psalm",
      chapter: "78",
      verseRange: "40-64",
      version: "NKJV",
    });
  });

  it("keeps colon-separated references working", () => {
    expect(parseBibleReference("1 Corinthians 13:1-13 KJV")).toEqual({
      book: "1 Corinthians",
      chapter: "13",
      verseRange: "1-13",
      version: "KJV",
    });
  });

  it("builds Bible search strings from parsed references", () => {
    const ref = parseBibleReference("Psalm 78 40-64 NKJV");

    expect(ref && bibleRefToSearchString(ref)).toBe("Psalm 78:40-64");
  });
});
