import {
  parseBibleSearchReference,
  resolveBibleBookName,
} from "../../utils/bibleReferenceParser";

export type ParsedBibleRef = {
  book: string;
  chapter: string;
  verseRange: string;
  version: string;
};

/**
 * A plan row labels the reading about as often as it just states it —
 * "Scripture: Psalm 23", "Reading — John 3:16". The label is words only: a
 * leading digit would be a book number ("1 Corinthians 13:1-13"), never a label.
 */
const LEADING_LABEL = /^[A-Za-z][A-Za-z'’ ]{0,30}[:–—-]\s*/;

/** Trailing parenthetical that isn't a version — "Psalm 23 (read by Ana)". */
const TRAILING_PARENTHETICAL = /\s*\([^()]*\)\s*$/;

/**
 * Progressively less decorated readings of a planning title. The untouched
 * title is always tried first, so a decoration that is actually part of the
 * reference (a bracketed version, which `parseBibleSearchReference` unwraps
 * itself) is never stripped out from under it.
 */
const referenceCandidates = (title: string): string[] => {
  const trimmed = title.trim();
  const candidates = [trimmed];

  const withoutParenthetical = trimmed.replace(TRAILING_PARENTHETICAL, "");
  if (withoutParenthetical && withoutParenthetical !== trimmed) {
    candidates.push(withoutParenthetical);
  }

  for (const candidate of [...candidates]) {
    const withoutLabel = candidate.replace(LEADING_LABEL, "");
    if (withoutLabel && withoutLabel !== candidate) candidates.push(withoutLabel);
  }

  return candidates;
};

/**
 * Parse a planning title into a structured Bible reference, or null when the
 * title isn't one. Uses the same grammar as the Bible search box, then holds it
 * to a real Bible book — the search box matches partial books while an operator
 * types, but a planning row that says "Welcome 5" is not scripture.
 */
export const parseBibleReference = (title: string): ParsedBibleRef | null => {
  if (/https?:\/\/|\.org|\.com/i.test(title)) return null;

  for (const candidate of referenceCandidates(title)) {
    const parsed = parseBibleSearchReference(candidate);
    if (!parsed?.chapter) continue;

    const book = resolveBibleBookName(parsed.book);
    if (!book) continue;

    return {
      book,
      chapter: parsed.chapter,
      verseRange: parsed.startVerse
        ? `${parsed.startVerse}${parsed.endVerse ? `-${parsed.endVerse}` : ""}`
        : "",
      version: parsed.version.toUpperCase(),
    };
  }

  return null;
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
