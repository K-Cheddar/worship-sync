import { ItemSlideType } from "../types";

/** Strip zero-width letter suffix from song slide names (e.g. "ChorusA" -> "Chorus"). */
export const getBaseLyricName = (slideName: string) =>
  slideName.replace(/\u200B[a-z]+\u200B$/, "");

export type SelectionHint = {
  baseLyricName: string;
  occurrenceIndex: number;
  slideIndexInSection: number;
};

/** Get a stable hint for the slide at selectedSlideIndex so we can find the same logical slide after reformat. */
export const getSelectionHint = (
  slides: ItemSlideType[],
  selectedSlideIndex: number
): SelectionHint | null => {
  const slide = slides[selectedSlideIndex];
  if (!slide) return null;
  const baseLyricName = getBaseLyricName(slide.name);
  if (!baseLyricName) return null;
  let sectionStart = -1;
  for (let i = 0; i <= selectedSlideIndex; i++) {
    const base = getBaseLyricName(slides[i]?.name ?? "");
    if (base !== baseLyricName) continue;
    const isSectionStart =
      i === 0 || getBaseLyricName(slides[i - 1]?.name ?? "") !== baseLyricName;
    if (isSectionStart) sectionStart = i;
  }
  if (sectionStart < 0) return null;
  let occurrenceIndex = 0;
  for (let i = 0; i < sectionStart; i++) {
    const base = getBaseLyricName(slides[i]?.name ?? "");
    const isSectionStart =
      base === baseLyricName &&
      (i === 0 || getBaseLyricName(slides[i - 1]?.name ?? "") !== baseLyricName);
    if (isSectionStart) occurrenceIndex += 1;
  }
  const slideIndexInSection = selectedSlideIndex - sectionStart;
  return { baseLyricName, occurrenceIndex, slideIndexInSection };
};

/** Find the slide index in newSlides that matches the given hint (same section occurrence and position). */
export const getIndexFromSelectionHint = (
  newSlides: ItemSlideType[],
  hint: SelectionHint
): number => {
  if (newSlides.length === 0) return 0;
  const sections: {
    base: string;
    occurrenceIndex: number;
    start: number;
    end: number;
  }[] = [];
  const occurrenceCountByBase = new Map<string, number>();
  const sectionStartByBase = new Map<string, number>();
  for (let i = 0; i < newSlides.length; i++) {
    const base = getBaseLyricName(newSlides[i]?.name ?? "");
    const prevBase =
      i > 0 ? getBaseLyricName(newSlides[i - 1]?.name ?? "") : "";
    if (prevBase !== base) {
      occurrenceCountByBase.set(
        base,
        (occurrenceCountByBase.get(base) ?? 0) + 1
      );
      sectionStartByBase.set(base, i);
    }
    const occ = (occurrenceCountByBase.get(base) ?? 1) - 1;
    const start = sectionStartByBase.get(base) ?? i;
    const isLastInSection =
      i === newSlides.length - 1 ||
      getBaseLyricName(newSlides[i + 1]?.name ?? "") !== base;
    if (isLastInSection) {
      sections.push({ base, occurrenceIndex: occ, start, end: i });
    }
  }
  const section = sections.find(
    (s) =>
      s.base === hint.baseLyricName && s.occurrenceIndex === hint.occurrenceIndex
  );
  if (!section) return 0;
  const sectionLength = section.end - section.start + 1;
  const offset = Math.min(hint.slideIndexInSection, sectionLength - 1);
  return section.start + offset;
};
