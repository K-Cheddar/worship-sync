import { ItemState } from "../types";
import { formatFree, formatSong } from "./overflow";

const EXTRA_NEWLINES_PATTERN = /\n{2,}/;

export const removeExtraNewlines = (text: string): string =>
  text.trim().replace(/\n{2,}/g, "\n");

export const itemHasCleanableNewlines = (item: ItemState): boolean => {
  if (item.type === "song") {
    const arrangement = item.arrangements[item.selectedArrangement];
    if (!arrangement?.formattedLyrics?.length) return false;

    return arrangement.formattedLyrics.some(
      (section) =>
        typeof section.words === "string" &&
        EXTRA_NEWLINES_PATTERN.test(section.words)
    );
  }

  if (item.type === "free") {
    if (!item.formattedSections?.length) return false;

    return item.formattedSections.some(
      (section) =>
        typeof section.words === "string" &&
        EXTRA_NEWLINES_PATTERN.test(section.words)
    );
  }

  return false;
};

export const cleanItemNewlines = (item: ItemState): ItemState => {
  if (item.type === "song") {
    const arrangement = item.arrangements[item.selectedArrangement];
    if (!arrangement?.formattedLyrics?.length) return item;

    const updatedArrangements = item.arrangements.map((arrangement, index) =>
      index === item.selectedArrangement
        ? {
            ...arrangement,
            formattedLyrics: arrangement.formattedLyrics.map((section) =>
              typeof section.words === "string"
                ? { ...section, words: removeExtraNewlines(section.words) }
                : section
            ),
          }
        : arrangement
    );

    return formatSong({
      ...item,
      arrangements: updatedArrangements,
    });
  }

  if (item.type === "free") {
    if (!item.formattedSections?.length) return item;

    return formatFree({
      ...item,
      formattedSections: item.formattedSections.map((section) =>
        typeof section.words === "string"
          ? { ...section, words: removeExtraNewlines(section.words) }
          : section
      ),
    });
  }

  return item;
};
