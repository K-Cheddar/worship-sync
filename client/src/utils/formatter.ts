import { ItemState } from "../types";
import { formatBible, formatSong } from "./overflow";

const getSlidesFromItem = (item: ItemState) => {
  let { selectedSlide } = item;
  let slides;
  if (item.type === "song")
    slides = item.arrangements[item.selectedArrangement].slides || null;
  else slides = item.slides || null;
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
    slides = slides.map((slide) => {
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
        return { ...arr, slides: _item.slides };
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

  slides = slides.map((slide) => {
    return {
      ...slide,
      boxes: slide.boxes.map((box, index) => {
        if (index !== 0) return box;
        return {
          ...box,
          brightness: brightness,
        };
      }),
    };
  });

  return {
    ...item,
    slides: [...slides],
  };
};
