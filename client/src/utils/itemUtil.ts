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
import { sortNamesInList } from "./sort";

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
        createNewSlide({ type: "Title", fontSize: 4.5, words: ["", name] }),
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

type updateFormattedSectionsType = {
  formattedLyrics: FormattedLyrics[];
  songOrder: SongOrder[];
};

export const updateFormattedSections = ({
  formattedLyrics: _formattedLyrics,
  songOrder: _songOrder,
}: updateFormattedSectionsType) => {
  const formattedLyrics = [..._formattedLyrics];
  let songOrder = _songOrder.length > 0 ? [..._songOrder] : [];

  let sections: string[] = [];
  let sectionUpdates: any = {};
  let sectionCounter: any = {};

  for (let i = 0; i < formattedLyrics.length; i++) {
    if (formattedLyrics[i].type in sectionCounter) {
      sectionCounter[formattedLyrics[i].type] += 1;
      sectionCounter[formattedLyrics[i].type + "_counter"] += 1;
    } else {
      sectionCounter[formattedLyrics[i].type] = 1;
      sectionCounter[formattedLyrics[i].type + "_counter"] = 0;
    }
  }

  for (let i = 0; i < formattedLyrics.length; i++) {
    let type = formattedLyrics[i].type;
    let max = sectionCounter[type];
    let counter = sectionCounter[type + "_counter"];
    let name;

    if (max === 1) {
      name = type;
    } else {
      name = type + " " + (max - counter);
      sectionCounter[type + "_counter"] -= 1;
    }

    sectionUpdates[formattedLyrics[i].name] = {
      newName: name,
      changed: formattedLyrics[i].name !== name,
    };
    const copiedLyric = { ...formattedLyrics[i] };
    copiedLyric.name = name;
    formattedLyrics[i] = copiedLyric;
    sections.push(name);
  }

  for (let i = 0; i < songOrder.length; i++) {
    let section = songOrder[i];
    if (sectionUpdates[section.name] && sectionUpdates[section.name].changed) {
      const songOrderObj = { ...songOrder[i] };
      songOrderObj.name = sectionUpdates[section.name].newName;
      songOrder[i] = songOrderObj;
    }
  }

  if (songOrder.length === 0) {
    songOrder = sections.map((section) => {
      return {
        name: section,
        id: generateRandomId(),
      };
    });
  }

  const sortedFormattedLyrics = sortNamesInList(formattedLyrics);

  return {
    formattedLyrics: sortedFormattedLyrics,
    songOrder,
  };
};

type CreateNewFreeFormType = { name: string };

export const createNewFreeForm = ({
  name,
}: CreateNewFreeFormType): ItemState => {
  const newItem: ItemState = {
    name,
    type: "free",
    id: generateRandomId(),
    selectedArrangement: 0,
    selectedSlide: 0,
    selectedBox: 1,
    slides: [
      createNewSlide({ type: "Section", fontSize: 4.5, words: ["", name] }),
      createNewSlide({ type: "Section", fontSize: 2.5, words: [""] }),
    ],
    arrangements: [],
    listId: "",
  };

  return newItem;
};
