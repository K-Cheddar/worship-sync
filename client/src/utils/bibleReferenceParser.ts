import { bibleVersions } from "./bibleVersions";
import { bibleStructure } from "./bibleStructure";

export type ParsedBibleSearchReference = {
  book: string;
  chapter: string;
  startVerse: string;
  endVerse: string;
  version: string;
};

export type ExtractedBibleReferenceStatus =
  | "ready"
  | "duplicate"
  | "not_found"
  | "error";

export type ExtractedBibleReference = {
  id: string;
  book: string;
  chapter: string;
  verseRange: string;
  version: string;
  sourceText: string;
  note?: string;
  status: ExtractedBibleReferenceStatus;
  statusMessage?: string;
  textPreview?: string;
};

export type BulkBibleImportReview = {
  id: string;
  createdAt: string;
  inputVersion: string;
  rows: ExtractedBibleReference[];
};

const bibleVersionValues = new Set(
  bibleVersions.map(({ value }) => value.toLowerCase()),
);

const normalizeBibleVersion = (value?: string) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeBookName = (value: string) =>
  value.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();

const makeBookAliases = () => {
  const aliases: Record<string, string> = {
    gen: "Genesis",
    ge: "Genesis",
    ex: "Exodus",
    exod: "Exodus",
    lev: "Leviticus",
    num: "Numbers",
    deut: "Deuteronomy",
    josh: "Joshua",
    judg: "Judges",
    ruth: "Ruth",
    "1 sam": "1 Samuel",
    "2 sam": "2 Samuel",
    "1 kgs": "1 Kings",
    "2 kgs": "2 Kings",
    "1 chron": "1 Chronicles",
    "2 chron": "2 Chronicles",
    neh: "Nehemiah",
    esth: "Esther",
    ps: "Psalm",
    psa: "Psalm",
    psalm: "Psalm",
    psalms: "Psalm",
    prov: "Proverbs",
    eccl: "Ecclesiastes",
    song: "Song of Solomon",
    "song of songs": "Song of Solomon",
    isa: "Isaiah",
    jer: "Jeremiah",
    lam: "Lamentations",
    ezek: "Ezekiel",
    dan: "Daniel",
    hos: "Hosea",
    obad: "Obadiah",
    jon: "Jonah",
    mic: "Micah",
    nah: "Nahum",
    hab: "Habakkuk",
    zeph: "Zephaniah",
    hag: "Haggai",
    zech: "Zechariah",
    mal: "Malachi",
    matt: "Matthew",
    mt: "Matthew",
    mk: "Mark",
    lk: "Luke",
    jn: "John",
    rom: "Romans",
    "1 cor": "1 Corinthians",
    "2 cor": "2 Corinthians",
    gal: "Galatians",
    eph: "Ephesians",
    phil: "Philippians",
    col: "Colossians",
    "1 thess": "1 Thessalonians",
    "2 thess": "2 Thessalonians",
    "1 tim": "1 Timothy",
    "2 tim": "2 Timothy",
    tit: "Titus",
    philem: "Philemon",
    heb: "Hebrews",
    jas: "James",
    "1 pet": "1 Peter",
    "2 pet": "2 Peter",
    "1 jn": "1 John",
    "2 jn": "2 John",
    "3 jn": "3 John",
    jude: "Jude",
    rev: "Revelation",
  };

  for (const book of bibleStructure.books) {
    aliases[normalizeBookName(book.name)] = book.name;
  }

  return aliases;
};

const bookAliases = makeBookAliases();
const bookAliasPattern = Object.keys(bookAliases)
  .sort((a, b) => b.length - a.length)
  .map((alias) =>
    alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+"),
  )
  .join("|");

const findGlobalVersion = (input: string) => {
  const normalized = input.replace(/[–—]/g, "-");
  const matches = [
    ...normalized.matchAll(
      /(?:^|\n|\b)(?:all\s+)?([A-Za-z][A-Za-z0-9]*)\s*$/gim,
    ),
  ];
  const version = normalizeBibleVersion(matches.at(-1)?.[1]);
  return bibleVersionValues.has(version) ? version : "";
};

const normalizeRange = (value: string) => value.replace(/\s*-\s*/g, "-");

const makeExtractionId = (
  book: string,
  chapter: string,
  verseRange: string,
  version: string,
) =>
  `${book.toLowerCase()}-${chapter}-${verseRange}-${version}`.replace(
    /[^a-z0-9]+/g,
    "-",
  );

export const parseBibleSearchReference = (
  value: string,
): ParsedBibleSearchReference | null => {
  const normalized = value.trim().replace(/[–—]/g, "-");
  if (!normalized) return null;

  const versionMatch = normalized.match(/\s+([A-Za-z][A-Za-z0-9]*)\s*$/);
  const parsedVersion = versionMatch?.[1].toLowerCase();
  const searchReference =
    parsedVersion && bibleVersionValues.has(parsedVersion)
      ? normalized.slice(0, versionMatch?.index ?? normalized.length).trim()
      : normalized;

  const pattern = new RegExp(
    [
      "^\\s*",
      "([1-3]?\\s*[A-Za-z]+(?:\\s+[A-Za-z]+)*)",
      "(?:\\s*(\\d+)",
      "(?:(?:\\s*:\\s*|\\s+)(\\d+)",
      "(?:(?:-\\s*|\\s+)(\\d+))?",
      ")?",
      ")?\\s*$",
    ].join(""),
  );

  const match = searchReference.match(pattern);
  if (!match) return null;

  const [, book, chapter = "", startVerse = "", endVerse = ""] = match;

  return {
    book: book || "",
    chapter,
    startVerse,
    endVerse,
    version:
      parsedVersion && bibleVersionValues.has(parsedVersion)
        ? parsedVersion
        : "",
  };
};

export const extractBibleReferencesFromText = (
  input: string,
  currentVersion: string,
): ExtractedBibleReference[] => {
  const normalizedInput = input.replace(/[–—]/g, "-").replace(/\u00a0/g, " ");
  const globalVersion = findGlobalVersion(normalizedInput);
  const fallbackVersion =
    globalVersion || normalizeBibleVersion(currentVersion) || "nkjv";
  const rowPattern = new RegExp(
    [
      `\\b(${bookAliasPattern})\\.?`,
      "\\s+",
      "(\\d+)",
      "\\s*(?::|\\s)\\s*",
      "(\\d+(?:\\s*-\\s*\\d+)?)",
      "(?:\\s+([A-Za-z][A-Za-z0-9]*))?",
      "(?:\\s*\\(([^)]*)\\))?",
    ].join(""),
    "gi",
  );

  const matches = [...normalizedInput.matchAll(rowPattern)];
  const rows: ExtractedBibleReference[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const rawBook = match[1] || "";
    const chapter = match[2] || "";
    const firstVerseRange = normalizeRange(match[3] || "");
    const inlineVersion = normalizeBibleVersion(match[4]);
    const note = match[5]?.trim();
    const book = bookAliases[normalizeBookName(rawBook)] || rawBook.trim();
    const version = bibleVersionValues.has(inlineVersion)
      ? inlineVersion
      : fallbackVersion;
    const sourceText = match[0].trim();
    const ranges = [firstVerseRange];
    const nextStart = matches[index + 1]?.index ?? normalizedInput.length;
    const continuationText = normalizedInput.slice(
      (match.index ?? 0) + match[0].length,
      nextStart,
    );

    for (const continuation of continuationText.matchAll(
      /,\s*(\d+(?:\s*-\s*\d+)?)(?=\s*(?:[,;)]|$|\n))/g,
    )) {
      ranges.push(normalizeRange(continuation[1] || ""));
    }

    for (const verseRange of ranges) {
      const duplicateKey = `${normalizeBookName(book)}|${chapter}|${verseRange}|${version}`;
      const isDuplicate = seen.has(duplicateKey);
      seen.add(duplicateKey);

      rows.push({
        id: `${makeExtractionId(book, chapter, verseRange, version)}-${rows.length}`,
        book,
        chapter,
        verseRange,
        version,
        sourceText,
        note,
        status: isDuplicate ? "duplicate" : "ready",
        statusMessage: isDuplicate
          ? "Already listed in this import."
          : undefined,
      });
    }
  }

  return rows;
};
