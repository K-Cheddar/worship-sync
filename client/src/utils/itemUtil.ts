import {
  Arrangment,
  FormattedLyrics,
  SongOrder,
  ItemState,
  OptionalItemState,
} from "../types";
import generateRandomId from "./generateRandomId";
import { formatSong } from "./overflow";
import { createNewSlide } from "./slideCreation";

type CreateSectionsType = {
  formattedLyrics?: FormattedLyrics[];
  songOrder?: SongOrder[];
  unformattedLyrics: string;
};

export const createSections = ({
  formattedLyrics,
  songOrder,
  unformattedLyrics,
}: CreateSectionsType): {
  formattedLyrics: FormattedLyrics[];
  songOrder: SongOrder[];
} => {
  const newLyrics: FormattedLyrics[] = formattedLyrics
    ? [...formattedLyrics]
    : [];
  const newSongOrder: SongOrder[] = songOrder ? [...songOrder] : [];
  const lines = unformattedLyrics.split("\n\n");

  for (let i = 0; i < lines.length; i++) {
    const name = "Verse " + (newLyrics.length === 0 ? "" : newLyrics.length);
    const index = newLyrics.findIndex((e) => e.words === lines[i]);
    if (index === -1) {
      newLyrics.push({
        type: "Verse",
        name,
        words: lines[i],
        id: generateRandomId(),
        slideSpan: 1,
      });
      newSongOrder.push({ name, id: generateRandomId() });
    } else {
      newSongOrder.push({
        name: newLyrics[index].name,
        id: generateRandomId(),
      });
    }
  }

  return { formattedLyrics: newLyrics, songOrder: newSongOrder };
};

type CreateNewSongType = {
  formattedLyrics: FormattedLyrics[];
  songOrder: SongOrder[];
  name: string;
};

export const createNewSong = ({
  name,
  formattedLyrics,
  songOrder,
}: CreateNewSongType): ItemState => {
  const arrangements: Arrangment[] = [
    {
      name: "Master",
      formattedLyrics,
      songOrder,
      id: generateRandomId(),
      slides: [
        createNewSlide({ type: "Title", fontSize: 4.5, words: [name] }),
        createNewSlide({ type: "Blank", fontSize: 2.5, words: [""] }),
      ],
    },
  ];

  const newItem: ItemState = {
    name,
    type: "song",
    id: generateRandomId(),
    selectedArrangement: 0,
    selectedSlide: 0,
    selectedBox: 1,
    slides: [],
    shouldSkipTitle: false,
    listId: "",
    arrangements,
  };

  const item = formatSong(newItem);

  return item;
};

export const createItemFromProps = ({
  name,
  type,
  id,
  selectedArrangement,
  shouldSkipTitle,
  listId,
  arrangements,
  selectedSlide,
  selectedBox,
  slides,
}: OptionalItemState) => {
  const item: ItemState = {
    name,
    type,
    id: id || generateRandomId(),
    selectedArrangement: selectedArrangement || 0,
    shouldSkipTitle,
    listId,
    arrangements: arrangements || [],
    selectedSlide: selectedSlide || 0,
    selectedBox: selectedBox || 1,
    slides: slides || [],
    isEditMode: false,
  };
  return item;
};
