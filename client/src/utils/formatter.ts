import { BibleFontMode, ItemSlide, ItemState } from "../types";
import { formatBible, formatFree, formatSong } from "./overflow";

type UpdateSlideBgPropertyType = {
  property: string;
  value: any;
  slideIndex?: number;
  slides: ItemSlide[];
};

export const updateSlideBgProperty = ({
  property,
  value,
  slideIndex,
  slides,
}: UpdateSlideBgPropertyType): ItemSlide[] => {
  const updatedSlides = slides.map((slide, sIndex) => {
    if (slideIndex !== undefined && slideIndex !== sIndex) return slide;
    return {
      ...slide,
      boxes: slide.boxes.map((box, boxIndex) => {
        if (boxIndex !== 0) return box;
        return {
          ...box,
          [property]: value,
        };
      }),
    };
  });

  return [...updatedSlides];
};

const getSlidesFromItem = (item: ItemState) => {
  let { selectedSlide } = item;
  let slides;
  if (item.type === "song") {
    slides = item.arrangements[item.selectedArrangement].slides || null;
  } else {
    slides = item.slides || null;
  }
  let slide = slides ? slides[selectedSlide] : null;
  return { slides, slide };
};

type UpdateFontSizeType = {
  fontSize: number;
  item: ItemState;
};
export const updateFontSize = ({
  fontSize,
  item,
}: UpdateFontSizeType): ItemState => {
  let { selectedSlide, selectedBox } = item;
  let _item = { ...item };

  let { slides, slide } = getSlidesFromItem(item);

  if (!slide) return item;

  slides = slides.map((slide, slideIndex) => {
    if (slideIndex !== selectedSlide) return slide;
    return {
      ...slide,
      boxes: slide.boxes.map((box, boxIndex) => {
        if (boxIndex !== selectedBox) return box;
        return {
          ...box,
          fontSize: fontSize,
        };
      }),
    };
  });

  _item = { ...item, slides: [...slides] };

  if (item.type === "bible" && selectedSlide !== 0)
    _item = formatBible({
      item: _item,
      mode: item.bibleInfo?.fontMode || "separate",
    });

  if (item.type === "free") {
    _item = formatFree({
      ..._item,
    });
  }

  if (item.type === "song") {
    _item = {
      ...item,
      arrangements: _item.arrangements.map((arr, index) => {
        if (index !== item.selectedArrangement) return arr;
        return { ...arr, slides: [...slides] };
      }),
    };
    _item = formatSong(_item);
  }

  if (selectedSlide >= slides.length) selectedSlide = slides.length - 1;

  return {
    ..._item,
    selectedSlide: selectedSlide,
    selectedBox,
  };
};

type UpdateFontColorType = {
  fontColor: string;
  item: ItemState;
};

export const updateFontColor = ({
  fontColor,
  item,
}: UpdateFontColorType): ItemState => {
  let { selectedSlide, selectedBox } = item;
  let _item = { ...item };

  let { slides, slide } = getSlidesFromItem(item);

  if (!slide) return item;

  slides = slides.map((slide, slideIndex) => {
    if (slideIndex !== selectedSlide) return slide;
    return {
      ...slide,
      boxes: slide.boxes.map((box, boxIndex) => {
        if (boxIndex !== selectedBox) return box;
        return {
          ...box,
          fontColor: fontColor,
        };
      }),
    };
  });

  if (item.type === "song") {
    _item = {
      ...item,
      arrangements: _item.arrangements.map((arr, index) => {
        if (index !== item.selectedArrangement) return arr;
        return { ...arr, slides: [...slides] };
      }),
    };
  }

  _item = { ..._item, slides: [...slides] };

  return _item;
};

type UpdateBrightnessType = {
  brightness: number;
  item: ItemState;
};

export const updateBrightness = ({
  brightness,
  item,
}: UpdateBrightnessType): ItemState => {
  //use boxIndex
  let { slides, slide } = getSlidesFromItem(item);

  if (!slide) return item;

  slides = updateSlideBgProperty({
    property: "brightness",
    value: brightness,
    slides: [...slides],
    slideIndex: item.type === "free" ? item.selectedSlide : undefined,
  });

  const arrangements = item.arrangements.map((arr, index) => {
    if (index !== item.selectedArrangement) return arr;
    return { ...arr, slides: [...slides] };
  });

  return {
    ...item,
    slides: [...slides],
    arrangements: [...arrangements],
  };
};

type UpdateKeepAspectRatioProps = {
  shouldKeepAspectRatio: boolean;
  item: ItemState;
};

export const updateKeepAspectRatio = ({
  shouldKeepAspectRatio,
  item,
}: UpdateKeepAspectRatioProps): ItemState => {
  let { slides, slide } = getSlidesFromItem(item);
  if (!slide) return item;

  slides = updateSlideBgProperty({
    property: "shouldKeepAspectRatio",
    value: shouldKeepAspectRatio,
    slideIndex: item.selectedSlide,
    slides: [...slides],
  });

  return {
    ...item,
    slides: [...slides],
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
};

export const updateBibleFontMode = ({
  fontMode,
  item,
}: UpdateBibleFontModeType): ItemState => {
  const updatedItem = formatBible({
    item,
    mode: fontMode,
  });
  return updatedItem;
};
