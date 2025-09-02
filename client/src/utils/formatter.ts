import {
  BibleFontMode,
  FormattedTextDisplayInfo,
  Box,
  ItemState,
} from "../types";
import { formatBible, formatFree, formatSong } from "./overflow";

const getSlidesFromItem = (item: ItemState) => {
  const { selectedSlide } = item;
  let slides;
  if (item.type === "song") {
    slides = item.arrangements[item.selectedArrangement].slides || null;
  } else {
    slides = item.slides || null;
  }
  const slide = slides ? slides[selectedSlide] : null;
  return { slides, slide };
};

type UpdateBoxPropertiesType = {
  updatedProperties: Partial<Box>;
  item: ItemState;
  shouldApplyToAll?: boolean;
  shouldFormatItem?: boolean;
  shouldUpdateBgOnly?: boolean;
  shouldSkipTitleSlide?: boolean;
  isMobile: boolean;
};
export const updateBoxProperties = ({
  updatedProperties,
  item,
  shouldApplyToAll = false,
  shouldFormatItem = false,
  shouldUpdateBgOnly = false,
  shouldSkipTitleSlide = true,
  isMobile,
}: UpdateBoxPropertiesType): ItemState => {
  let { selectedSlide, selectedBox } = item;
  let _item = { ...item };

  let { slides, slide } = getSlidesFromItem(item);

  if (!slide) return item;

  slides = slides.map((slide, slideIndex) => {
    if (item.type === "song") {
      // If the first slide isn't selected, don't apply changes
      if (slideIndex === 0 && selectedSlide !== 0 && shouldSkipTitleSlide)
        return slide;
    }

    if (slideIndex !== selectedSlide && !shouldApplyToAll) return slide;
    return {
      ...slide,
      boxes: slide.boxes.map((box, boxIndex) => {
        if (shouldUpdateBgOnly && boxIndex !== 0) return box;
        if (boxIndex !== selectedBox && !shouldUpdateBgOnly) return box;
        return {
          ...box,
          ...updatedProperties,
        };
      }),
    };
  });

  _item = { ...item, slides: [...slides] };

  if (item.type === "bible" && selectedSlide !== 0 && shouldFormatItem)
    _item = formatBible({
      item: _item,
      mode: item.bibleInfo?.fontMode || "separate",
      isMobile,
    });

  if (item.type === "free" && shouldFormatItem) {
    _item = formatFree(
      {
        ..._item,
      },
      isMobile
    );
  }

  if (item.type === "song") {
    _item = {
      ...item,
      arrangements: _item.arrangements.map((arr, index) => {
        if (index !== item.selectedArrangement) return arr;
        return { ...arr, slides: [...slides] };
      }),
    };
    if (shouldFormatItem) {
      _item = formatSong(_item, isMobile);
    }
  }

  if (selectedSlide >= slides.length) selectedSlide = slides.length - 1;

  return {
    ..._item,
    selectedSlide: selectedSlide,
    selectedBox,
  };
};

type UpdateItemTimerColorType = {
  timerColor: string;
  item: ItemState;
};

export const updateItemTimerColor = ({
  timerColor,
  item,
}: UpdateItemTimerColorType): ItemState => {
  if (!item.timerInfo) return item;

  return { ...item, timerInfo: { ...item.timerInfo, color: timerColor } };
};

type UpdateBibleFontModeType = {
  fontMode: BibleFontMode;
  item: ItemState;
  isMobile: boolean;
};

export const updateBibleFontMode = ({
  fontMode,
  item,
  isMobile,
}: UpdateBibleFontModeType): ItemState => {
  const updatedItem = formatBible({
    item,
    mode: fontMode,
    isMobile,
  });
  return updatedItem;
};

type UpdateFormattedTextDisplayInfoType = {
  formattedTextDisplayInfo: FormattedTextDisplayInfo;
  item: ItemState;
  shouldApplyToAll: boolean;
};

export const updateFormattedTextDisplayInfo = ({
  formattedTextDisplayInfo,
  item,
  shouldApplyToAll,
}: UpdateFormattedTextDisplayInfoType): ItemState => {
  const { slides, selectedSlide } = item;

  const updatedSlides = slides.map((slide, slideIndex) => {
    if (slideIndex !== selectedSlide && !shouldApplyToAll) return slide;
    return { ...slide, formattedTextDisplayInfo: formattedTextDisplayInfo };
  });

  return { ...item, slides: [...updatedSlides] };
};
