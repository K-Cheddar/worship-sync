import type PouchDB from "pouchdb-browser";
import { getVerses as getVersesApi } from "../api/getVerses";
import type { ParsedBibleRef } from "../integrations/servicePlanning/parseBibleReference";
import type {
  BibleFontMode,
  DBBibleChapter,
  ItemState,
  MediaType,
  ServiceItem,
  verseType,
} from "../types";
import { bibleStructure } from "./bibleStructure";
import { createNewBible } from "./itemUtil";

type PouchLike = Pick<PouchDB.Database, "get" | "put">;

const DEFAULT_BIBLE_IMPORT_VERSION = "nkjv";

const normalizeBibleBookName = (value: string): string =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const BIBLE_BOOK_ALIASES: Record<string, string> = {
  psalm: "Psalms",
  psalms: "Psalms",
  "song of songs": "Song of Solomon",
  "song of solomon": "Song of Solomon",
};

const normalizeBibleImportVersion = (value?: string) =>
  String(value || DEFAULT_BIBLE_IMPORT_VERSION).trim().toLowerCase();

const resolveCanonicalBibleBookName = (book: string): string => {
  const normalizedBookName = normalizeBibleBookName(book);
  const aliasMatch = BIBLE_BOOK_ALIASES[normalizedBookName];
  if (aliasMatch) return aliasMatch;

  const exactMatch = bibleStructure.books.find(
    (candidate) =>
      normalizeBibleBookName(candidate.name) === normalizedBookName,
  );
  return exactMatch?.name || book.trim();
};

const parseVerseRange = (value?: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;

  const startVerse = Number(match[1]);
  const endVerse = Number(match[2] || match[1]);
  if (!Number.isInteger(startVerse) || !Number.isInteger(endVerse)) return null;
  if (startVerse < 1 || endVerse < startVerse) return null;

  return { startVerse, endVerse };
};

export const getBibleImportDisplayName = (
  ref: ParsedBibleRef,
  version = DEFAULT_BIBLE_IMPORT_VERSION,
) =>
  `${ref.book} ${ref.chapter}${ref.verseRange ? `:${ref.verseRange}` : ""} ${version.toUpperCase()}`.trim();

export const selectBibleVersesFromRange = (
  verses: verseType[],
  verseRange?: string,
) => {
  const parsed = parseVerseRange(verseRange);
  if (!parsed) return verses;

  const startIndex = parsed.startVerse - 1;
  const endIndex = parsed.endVerse - 1;
  return verses.filter(
    ({ index }) => index >= startIndex && index <= endIndex,
  );
};

export const loadBibleChapterVerses = async ({
  book,
  chapter,
  version,
  bibleDb,
}: {
  book: string;
  chapter: string;
  version?: string;
  bibleDb?: PouchLike | undefined;
}): Promise<verseType[]> => {
  const normalizedVersion = normalizeBibleImportVersion(version);
  const canonicalBook = resolveCanonicalBibleBookName(book);
  const chapterName = String(chapter || "").trim();
  const chapterNumber = Number(chapterName);
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) return [];

  const bibleDbKey = `${normalizedVersion}-${canonicalBook}-${chapterName}`;
  let chapterDoc: DBBibleChapter | null = null;

  if (bibleDb) {
    try {
      chapterDoc = (await bibleDb.get(bibleDbKey)) as DBBibleChapter;
    } catch {
      chapterDoc = null;
    }

    if (chapterDoc?.verses?.length) {
      return chapterDoc.verses;
    }
  }

  try {
    const data = await getVersesApi({
      book: canonicalBook,
      chapter: chapterNumber - 1,
      version: normalizedVersion,
    });
    if (data?.verses?.length) {
      if (bibleDb) {
        const now = new Date().toISOString();
        const nextDoc = chapterDoc
          ? {
              ...chapterDoc,
              key: bibleDbKey,
              verses: data.verses,
              book: canonicalBook,
              name: chapterName,
              index: chapterNumber - 1,
              version: normalizedVersion,
              lastUpdated: now,
              isFromBibleGateway: true,
              updatedAt: now,
            }
          : {
              _id: bibleDbKey,
              key: bibleDbKey,
              verses: data.verses,
              book: canonicalBook,
              name: chapterName,
              index: chapterNumber - 1,
              version: normalizedVersion,
              lastUpdated: now,
              isFromBibleGateway: true,
              createdAt: now,
              updatedAt: now,
            };
        try {
          await bibleDb.put(nextDoc);
        } catch (error) {
          console.error("Could not cache Bible chapter for Service Planning:", error);
        }
      }
      return data.verses;
    }
  } catch (error) {
    console.error("Could not fetch Bible verses for Service Planning:", error);
  }

  return chapterDoc?.verses || [];
};

export const createBibleItemFromParsedReference = async ({
  parsedRef,
  name,
  db,
  bibleDb,
  allItems,
  background,
  mediaInfo,
  brightness,
  fontMode,
  defaultVersion = DEFAULT_BIBLE_IMPORT_VERSION,
}: {
  parsedRef: ParsedBibleRef;
  name?: string;
  db: PouchDB.Database | undefined;
  bibleDb?: PouchLike | undefined;
  allItems: ServiceItem[];
  background: string;
  mediaInfo?: MediaType;
  brightness: number;
  fontMode: BibleFontMode;
  defaultVersion?: string;
}): Promise<ItemState> => {
  const version = normalizeBibleImportVersion(parsedRef.version || defaultVersion);
  const canonicalBook = resolveCanonicalBibleBookName(parsedRef.book);
  const chapterVerses = await loadBibleChapterVerses({
    book: canonicalBook,
    chapter: parsedRef.chapter,
    version,
    bibleDb,
  });
  if (chapterVerses.length === 0) {
    throw new Error(`Could not load Bible passage for "${canonicalBook} ${parsedRef.chapter}".`);
  }

  const verses = selectBibleVersesFromRange(
    chapterVerses,
    parsedRef.verseRange,
  );
  if (verses.length === 0) {
    throw new Error(
      `Could not find the requested Bible verses for "${parsedRef.book} ${parsedRef.chapter}${parsedRef.verseRange ? `:${parsedRef.verseRange}` : ""}".`,
    );
  }

  return createNewBible({
    name: name?.trim() || getBibleImportDisplayName(parsedRef, version),
    book: canonicalBook,
    chapter: parsedRef.chapter,
    version,
    verses,
    db,
    list: allItems,
    background,
    mediaInfo,
    brightness,
    fontMode,
  });
};
