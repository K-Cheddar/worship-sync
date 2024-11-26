import { ItemSlide, ItemState } from "../types";
import { formatBible, formatSong } from "./overflow";

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

  if (selectedSlide !== 0 && item.type !== "free") {
    slides = slides.map((slide, index) => {
      if (index === 0) return slide;
      return {
        ...slide,
        boxes: slide.boxes.map((box) => {
          if (box.excludeFromOverflow) return box;
          return {
            ...box,
            fontSize: fontSize,
          };
        }),
      };
    });
  } else {
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
  }

  _item = { ...item, slides: [...slides] };

  if (item.type === "bible" && selectedSlide !== 0)
    _item = formatBible({ item: _item, mode: "add" });

  if (item.type === "song" && selectedSlide !== 0) {
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

  // needsUpdate.updateItem = true;

  return {
    ..._item,
    selectedSlide: selectedSlide,
    selectedBox,
  };
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
