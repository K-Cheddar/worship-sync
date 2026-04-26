import { bibleVersions } from "./bibleVersions";

export type ParsedBibleSearchReference = {
  book: string;
  chapter: string;
  startVerse: string;
  endVerse: string;
  version: string;
};

const bibleVersionValues = new Set(
  bibleVersions.map(({ value }) => value.toLowerCase())
);

export const parseBibleSearchReference = (
  value: string
): ParsedBibleSearchReference | null => {
  const normalized = value.trim().replace(/[–—]/g, "-");
  if (!normalized) return null;

  const versionMatch = normalized.match(/\s+([A-Za-z][A-Za-z0-9]*)\s*$/);
  const parsedVersion = versionMatch?.[1].toLowerCase();
  const searchReference =
    parsedVersion && bibleVersionValues.has(parsedVersion)
      ? normalized.slice(0, versionMatch.index ?? normalized.length).trim()
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
    ].join("")
  );

  const match = searchReference.match(pattern);
  if (!match) return null;

  const [, book, chapter = "", startVerse = "", endVerse = ""] = match;

  return {
    book: book || "",
    chapter,
    startVerse,
    endVerse,
    version: parsedVersion && bibleVersionValues.has(parsedVersion)
      ? parsedVersion
      : "",
  };
};
