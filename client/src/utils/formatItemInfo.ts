import { Cloudinary } from "@cloudinary/url-gen";
import { SongOrder, ItemState, DBItem } from "../types";
import generateRandomId from "./generateRandomId";

export const formatItemInfo = (item: DBItem, cloud: Cloudinary) => {
  const _item: ItemState = {
    name: item.name,
    type: item.type,
    _id: item._id,
    selectedArrangement: item.selectedArrangement,
    shouldSkipTitle: false,
    arrangements: [],
    slides: [],
    selectedBox: 1,
    selectedSlide: 0,
    bibleInfo: { book: "", chapter: "", version: "", verses: [] },
  };

  let updatedArrangements;
  let slides;

  if (item.type === "song") {
    updatedArrangements = item.arrangements.map((arrangement, arrIndex) => {
      let { formattedLyrics, slides, songOrder } = { ...arrangement };

      if (!formattedLyrics[0].id) {
        formattedLyrics = formattedLyrics.map((el) => {
          return { ...el, id: generateRandomId() };
        });
      }

      slides = slides.map((el) => {
        return {
          ...el,
          id: generateRandomId(),
          boxes: [
            ...el.boxes.map((box, index) => {
              const boxBackground = box.background?.startsWith("https")
                ? box.background
                : cloud.image(box.background).toURL();
              return {
                ...box,
                id: generateRandomId(),
                background: index === 1 ? "" : boxBackground,
                isLocked: index === 0 ? true : box.isLocked,
                brightness: index !== 0 ? 100 : box.brightness,
                width: box.width || 100,
                height: box.height || 100,
              };
            }),
          ],
        };
      });

      let songOrderWIds: SongOrder[] = [];

      if (typeof songOrder[0] === "string") {
        songOrderWIds = (songOrder as string[]).map((el) => {
          return { name: el, id: generateRandomId() };
        });
      } else {
        songOrderWIds = songOrder as SongOrder[];
      }

      return {
        name: item.arrangements[arrIndex].name,
        id: generateRandomId(),
        formattedLyrics,
        songOrder: songOrderWIds,
        slides,
      };
    });
    slides = updatedArrangements[item.selectedArrangement].slides;
  } else {
    slides = item.slides.map((slide) => {
      return {
        ...slide,
        id: generateRandomId(),
        boxes: [
          ...slide.boxes.map((box, index) => {
            return {
              ...box,
              id: generateRandomId(),
              background: index === 1 ? "" : box.background,
              isLocked: index === 0 ? true : box.isLocked,
              brightness: index !== 0 ? 100 : box.brightness,
              width: box.width || 100,
              height: box.height || 100,
            };
          }),
        ],
      };
    });
  }

  _item.arrangements = updatedArrangements || [];
  _item.slides = slides || [];
  return _item;
};