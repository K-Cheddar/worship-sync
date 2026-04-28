import { parseBibleSearchReference } from "../../utils/bibleReferenceParser";

export type ParsedBibleRef = {
  book: string;
  chapter: string;
  verseRange: string;
  version: string;
};

/**
 * Parse a planning title into a structured Bible reference.
 * Uses the same grammar as the Bible search box.
 */
export const parseBibleReference = (title: string): ParsedBibleRef | null => {
  if (/https?:\/\/|\.org|\.com/i.test(title)) return null;

  const parsed = parseBibleSearchReference(title);
  if (!parsed?.chapter) return null;

  const verseRange = parsed.startVerse
    ? `${parsed.startVerse}${parsed.endVerse ? `-${parsed.endVerse}` : ""}`
    : "";

  return {
    book: parsed.book,
    chapter: parsed.chapter,
    verseRange,
    version: parsed.version.toUpperCase(),
  };
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
