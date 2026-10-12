import type {
  Box,
  FormattedTextDisplayInfo,
  ItemSlideType,
  ItemState,
} from "../types";
import {
  updateBoxProperties,
  updateFormattedTextDisplayInfo,
} from "./formatter";
import { cleanItemNewlines } from "./itemNewlineCleanup";
import { formatFree, formatSong } from "./overflow";

export type FormattedTextField =
  | "paddingX"
  | "paddingY"
  | "fontSize"
  | "textColor"
  | "backgroundColor"
  | "align"
  | "isBold"
  | "isItalic";

export type OwnedItemContentMutation =
  | {
      kind: "boxProperties";
      slideId: string;
      slideIndex: number;
      sectionNum?: number;
      arrangementId?: string;
      boxIndex: number;
      properties: Partial<Box>;
      applyToAll?: boolean;
      formatItem?: boolean;
      updateBackgroundOnly?: boolean;
      skipTitleSlide?: boolean;
    }
  | {
      kind: "formattedText";
      slideId: string;
      slideIndex: number;
      sectionNum?: number;
      field: FormattedTextField;
      value: string | number | boolean;
      applyToAll: boolean;
    }
  | {
      kind: "sectionText";
      slideId: string;
      slideIndex: number;
      sectionNum?: number;
      arrangementId?: string;
      sectionId?: string;
      sectionName?: string;
      value: string;
    }
  | {
      kind: "sectionTextDraft";
      slideId: string;
      slideIndex: number;
      sectionNum: number;
      value: string;
    }
  | {
      kind: "boxWords";
      slideId: string;
      slideIndex: number;
      sectionNum?: number;
      boxIndex: number;
      value: string;
    }
  | {
      kind: "overflow";
      slideId: string;
      slideIndex: number;
      sectionNum?: number;
      value: "fit" | "separate";
    }
  | {
      kind: "cleanNewlines";
      arrangementId?: string;
    };

export type OwnedItemContentUpdate = Partial<
  Pick<ItemState, "slides" | "arrangements" | "formattedSections">
>;

const findTargetSlides = (
  item: ItemState,
  arrangementId?: string,
): { slides: ItemSlideType[]; arrangementIndex: number } | null => {
  if (item.type !== "song") return { slides: item.slides, arrangementIndex: -1 };
  const arrangementIndex = arrangementId
    ? item.arrangements.findIndex((arrangement) => arrangement.id === arrangementId)
    : item.selectedArrangement;
  const slides = item.arrangements[arrangementIndex]?.slides;
  if (!slides) return null;
  return { slides, arrangementIndex };
};

const withTargetArrangement = (
  item: ItemState,
  arrangementIndex: number,
): ItemState => ({ ...item, selectedArrangement: arrangementIndex });

const songContentUpdate = (
  item: ItemState,
  updatedItem: ItemState,
  arrangementIndex: number,
): OwnedItemContentUpdate => ({
  arrangements: updatedItem.arrangements,
  ...(item.selectedArrangement === arrangementIndex
    ? { slides: updatedItem.arrangements[arrangementIndex]?.slides ?? updatedItem.slides }
    : {}),
});

const defaultFormattedTextInfo: FormattedTextDisplayInfo = {
  text: "",
  backgroundColor: "#eb8934",
  textColor: "#ffffff",
  fontSize: 1.5,
  paddingX: 2,
  paddingY: 1,
  align: "left",
  isBold: false,
  isItalic: false,
};

const findSlideIndex = (
  slides: ItemSlideType[],
  slideId: string,
  fallbackIndex: number,
  sectionNum?: number,
) => {
  const exactIndex = slides.findIndex((slide) => slide.id === slideId);
  if (exactIndex !== -1) return exactIndex;
  if (sectionNum !== undefined) {
    const sectionSlides = slides
      .map((slide, index) => ({ slide, index }))
      .filter(({ slide }) =>
        Number(slide.name.match(/Section (\d+)/)?.[1]) === sectionNum,
      );
    if (sectionSlides.length > 0) {
      return sectionSlides.reduce((closest, candidate) =>
        Math.abs(candidate.index - fallbackIndex) <
        Math.abs(closest.index - fallbackIndex)
          ? candidate
          : closest,
      ).index;
    }
  }
  return slides[fallbackIndex] ? fallbackIndex : -1;
};

export const applyOwnedItemContentMutation = (
  item: ItemState,
  mutation: OwnedItemContentMutation,
): OwnedItemContentUpdate | null => {
  if (mutation.kind === "cleanNewlines") {
    const target = findTargetSlides(item, mutation.arrangementId);
    if (!target) return null;
    const workingItem = withTargetArrangement(item, target.arrangementIndex);
    const updated = cleanItemNewlines(workingItem);
    if (item.type === "song") {
      return songContentUpdate(item, updated, target.arrangementIndex);
    }
    return {
      slides: updated.slides,
      formattedSections: updated.formattedSections,
    };
  }

  if (mutation.kind === "formattedText") {
    const targetSlideIndex = findSlideIndex(
      item.slides,
      mutation.slideId,
      mutation.slideIndex,
      mutation.sectionNum,
    );
    if (targetSlideIndex === -1) return null;
    const currentInfo =
      item.slides[targetSlideIndex]?.formattedTextDisplayInfo ??
      defaultFormattedTextInfo;
    const workingItem = { ...item, selectedSlide: targetSlideIndex };
    const updated = updateFormattedTextDisplayInfo({
      formattedTextDisplayInfo: {
        ...currentInfo,
        [mutation.field]: mutation.value,
        text: currentInfo.text || "",
      },
      item: workingItem,
      shouldApplyToAll: mutation.applyToAll,
    });
    return { slides: updated.slides };
  }

  if (mutation.kind === "sectionText") {
    if (item.type === "song") {
      const target = findTargetSlides(item, mutation.arrangementId);
      if (!target || !mutation.arrangementId) return null;
      const arrangement = item.arrangements[target.arrangementIndex];
      const lyricIndex = arrangement?.formattedLyrics.findIndex((lyric) =>
        mutation.sectionId
          ? lyric.id === mutation.sectionId
          : lyric.name === mutation.sectionName,
      ) ?? -1;
      if (!arrangement || lyricIndex === -1) return null;
      const arrangements = item.arrangements.map((entry, index) =>
        index === target.arrangementIndex
          ? {
              ...entry,
              formattedLyrics: entry.formattedLyrics.map((lyric, index) =>
                index === lyricIndex ? { ...lyric, words: mutation.value } : lyric,
              ),
            }
          : entry,
      );
      const updated = formatSong({
        ...item,
        arrangements,
        selectedArrangement: target.arrangementIndex,
      });
      return songContentUpdate(item, updated, target.arrangementIndex);
    }

    if (item.type === "free" && mutation.sectionNum !== undefined) {
      if (
        findSlideIndex(
          item.slides,
          mutation.slideId,
          mutation.slideIndex,
          mutation.sectionNum,
        ) === -1
      ) return null;
      const formattedSections = item.formattedSections || [];
      const updatedSections = formattedSections.map((section) =>
        section.sectionNum === mutation.sectionNum
          ? { ...section, words: mutation.value }
          : section,
      );
      if (!formattedSections.some((section) => section.sectionNum === mutation.sectionNum)) {
        updatedSections.push({
          sectionNum: mutation.sectionNum,
          words: mutation.value,
          slideSpan: 1,
        });
      }
      const updated = formatFree({ ...item, formattedSections: updatedSections });
      return {
        slides: updated.slides,
        formattedSections: updated.formattedSections,
      };
    }
    return null;
  }

  if (mutation.kind === "sectionTextDraft") {
    if (
      item.type !== "free" ||
      findSlideIndex(
        item.slides,
        mutation.slideId,
        mutation.slideIndex,
        mutation.sectionNum,
      ) === -1
    ) {
      return null;
    }
    const formattedSections = item.formattedSections || [];
    const updatedSections = formattedSections.map((section) =>
      section.sectionNum === mutation.sectionNum
        ? { ...section, words: mutation.value }
        : section,
    );
    if (!formattedSections.some((section) => section.sectionNum === mutation.sectionNum)) {
      updatedSections.push({
        sectionNum: mutation.sectionNum,
        words: mutation.value,
        slideSpan: 1,
      });
    }
    return { formattedSections: updatedSections };
  }

  const arrangementId =
    mutation.kind === "boxProperties" ? mutation.arrangementId : undefined;
  const target = findTargetSlides(item, arrangementId);
  if (!target) return null;
  const targetSlideIndex = findSlideIndex(
    target.slides,
    mutation.slideId,
    mutation.slideIndex,
    "sectionNum" in mutation ? mutation.sectionNum : undefined,
  );
  if (targetSlideIndex === -1) return null;

  if (mutation.kind === "boxWords") {
    const slides = target.slides.map((slide, slideIndex) =>
      slideIndex !== targetSlideIndex
        ? slide
        : {
            ...slide,
            boxes: slide.boxes.map((box, boxIndex) =>
              boxIndex === mutation.boxIndex
                ? { ...box, words: mutation.value }
                : box,
            ),
          },
    );
    return item.type === "song"
      ? {
          arrangements: item.arrangements.map((arrangement, index) =>
            index === target.arrangementIndex ? { ...arrangement, slides } : arrangement,
          ),
          ...(item.selectedArrangement === target.arrangementIndex ? { slides } : {}),
        }
      : { slides };
  }

  if (mutation.kind === "overflow") {
    if (item.type !== "free") return null;
    const slides = item.slides.map((slide, slideIndex) =>
      slideIndex === targetSlideIndex ? { ...slide, overflow: mutation.value } : slide,
    );
    const updated = formatFree({ ...item, slides });
    return { slides: updated.slides };
  }

  const workingItem: ItemState = {
    ...item,
    selectedArrangement: target.arrangementIndex,
    selectedSlide: targetSlideIndex,
    selectedBox: mutation.boxIndex,
  };
  const updated = updateBoxProperties({
    updatedProperties: mutation.properties,
    item: workingItem,
    shouldApplyToAll: mutation.applyToAll,
    shouldFormatItem: mutation.formatItem,
    shouldUpdateBgOnly: mutation.updateBackgroundOnly,
    shouldSkipTitleSlide: mutation.skipTitleSlide,
  });
  if (item.type === "song") {
    return songContentUpdate(item, updated, target.arrangementIndex);
  }
  return {
    slides: updated.slides,
    formattedSections: updated.formattedSections,
  };
};
