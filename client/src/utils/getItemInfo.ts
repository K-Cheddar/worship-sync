import { DBItem, SongOrder, UpdateItemState } from "../types";
import generateRandomId from "./generateRandomId";

export const formatItemInfo = async (item: DBItem) => {
  const _item: UpdateItemState = {
    name: item.name,
    type: item.type,
    id: item.id,
    selectedArrangement: item.selectedArrangement,
    shouldSkipTitle: item.shouldSkipTitle,
    arrangements: [],
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
      name: item.arrangements[item.selectedArrangement].name,
      formattedLyrics,
      songOrder: songOrderWIds,
      slides,
    };
  });

  _item.arrangements = updatedArrangements;
  return _item;
};
