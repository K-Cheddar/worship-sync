import { ItemState } from "../types";
import { formatBible, formatSong } from "./overflow";

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

  let slides;
  if (item.type === "song")
    slides = item.arrangements[item.selectedArrangement].slides || null;
  else slides = item.slides || null;
  let slide = slides ? slides[selectedSlide] : null;

  if (!slide) return item;

  if (selectedSlide !== 0 && item.type !== "image") {
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
    _item = formatSong(item);
  }

  if (selectedSlide >= slides.length) selectedSlide = slides.length - 1;

  // needsUpdate.updateItem = true;
  return {
    ..._item,
    selectedSlide: selectedSlide,
    selectedBox,
  };
};
