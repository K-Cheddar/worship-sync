import { DBItem, SongOrder, ItemState } from "../types";
import generateRandomId from "./generateRandomId";

export const formatItemInfo = async (item: DBItem) => {
  const _item: ItemState = {
    name: item.name,
    type: item.type,
    id: item._id,
    selectedArrangement: item.selectedArrangement,
    shouldSkipTitle: item.skipTitle,
    arrangements: [],
    slides: [],
    selectedBox: 1,
    selectedSlide: 0,
  };

  const updatedArrangements = item.arrangements.map((arrangement) => {
    let { formattedLyrics, slides, songOrder } = { ...arrangement };

    if (!formattedLyrics[0].id) {
      formattedLyrics = formattedLyrics.map((el) => {
        return { ...el, id: generateRandomId() };
      });
    }

    if (!slides[0].id) {
      slides = slides.map((el) => {
        return {
          ...el,
          id: generateRandomId(),
          boxes: [
            ...el.boxes.map((box, index) => {
              return {
                ...box,
                id: generateRandomId(),
                background: index === 1 ? "" : box.background,
                isLocked: index === 0 ? true : box.isLocked,
              };
            }),
          ],
        };
      });
    }

    let songOrderWIds: SongOrder[] = [];

    if (typeof songOrder[0] === "string") {
      songOrderWIds = songOrder.map((el) => {
        return { name: el, id: generateRandomId() };
      });
    }

    return {
      name: item.arrangements[item.selectedArrangement || 0].name,
      id: generateRandomId(),
      formattedLyrics,
      songOrder: songOrderWIds,
      slides,
    };
  });

  _item.arrangements = updatedArrangements;
  _item.slides = updatedArrangements[item.selectedArrangement].slides;
  return _item;
};
