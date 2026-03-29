import { verseType } from "../../types";

/** Verses in [startVerse, endVerse] with non-empty text (what BibleVersesList renders). */
export const hasRenderableVersesInRange = (
  verses: verseType[],
  startVerse: number,
  endVerse: number
): boolean =>
  verses.some(
    (v) =>
      v.index >= startVerse &&
      v.index <= endVerse &&
      Boolean(v.text?.trim())
  );
