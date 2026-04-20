export type ParsedBibleRef = {
  book: string;
  chapter: string;
  verseRange: string;
  version: string;
};

// Known multi-word book names (order matters — longer names first).
const MULTI_WORD_BOOKS = [
  "Song of Solomon",
  "Song of Songs",
  "1 Samuel",
  "2 Samuel",
  "1 Kings",
  "2 Kings",
  "1 Chronicles",
  "2 Chronicles",
  "1 Corinthians",
  "2 Corinthians",
  "1 Thessalonians",
  "2 Thessalonians",
  "1 Timothy",
  "2 Timothy",
  "1 Peter",
  "2 Peter",
  "1 John",
  "2 John",
  "3 John",
  "1 Maccabees",
  "2 Maccabees",
];

// Known Bible version abbreviations (upper-case match).
const KNOWN_VERSIONS = new Set([
  "NIV", "KJV", "NKJV", "ESV", "NLT", "NASB", "NRSV", "MSG", "AMP",
  "CSB", "BSB", "NET", "GNT", "CEV", "TLB", "WEB", "ISV", "YLT", "ASV",
  "LSB", "RSV", "NCV", "ICB", "HCSB",
]);

/**
 * Parse a planning title into a structured Bible reference.
 * Handles formats like:
 *   "Psalm 78:1-8 NIV"
 *   "John 3:16 ESV"
 *   "1 Corinthians 13:1-13 KJV"
 *   "Revelation 1:1-3"           (no version → defaults to "")
 */
export const parseBibleReference = (title: string): ParsedBibleRef | null => {
  const s = title.trim();

  // Try multi-word books first
  for (const book of MULTI_WORD_BOOKS) {
    const re = new RegExp(
      `^${book}\\s+(\\d+):(\\d+(?:-\\d+)?)(?:\\s+([A-Z]+))?\\s*$`,
      "i",
    );
    const m = s.match(re);
    if (m) {
      return {
        book,
        chapter: m[1],
        verseRange: m[2],
        version: m[3] ? m[3].toUpperCase() : "",
      };
    }
  }

  // Single-word book: "Psalm", "John", "Genesis", etc.
  const singleRe =
    /^([1-3]?\s*[A-Za-z]+)\s+(\d+):(\d+(?:-\d+)?)(?:\s+([A-Z]+))?\s*$/i;
  const m = s.match(singleRe);
  if (!m) return null;

  const bookRaw = m[1].replace(/\s+/g, " ").trim();
  const chapter = m[2];
  const verseRange = m[3];
  const versionRaw = m[4] ? m[4].toUpperCase() : "";

  // Accept any trailing word as a version (common abbreviations validated above
  // are preferred; unknown abbreviations are still captured).
  const version =
    versionRaw &&
    (KNOWN_VERSIONS.has(versionRaw) || /^[A-Z]{2,6}$/.test(versionRaw))
      ? versionRaw
      : "";

  // Reject if the "book" looks like a URL or non-scripture string
  if (/https?:\/\/|\.org|\.com/.test(bookRaw)) return null;

  return { book: bookRaw, chapter, verseRange, version };
};

/** Build a query string for the `/controller/bible` route. */
export const bibleRefToUrlParams = (ref: ParsedBibleRef): string => {
  const params = new URLSearchParams({ book: ref.book, chapter: ref.chapter });
  if (ref.verseRange) params.set("verses", ref.verseRange);
  if (ref.version) params.set("version", ref.version);
  return params.toString();
};

export const bibleRefToSearchString = (ref: ParsedBibleRef): string =>
  `${ref.book} ${ref.chapter}${ref.verseRange ? `:${ref.verseRange}` : ""}`;
