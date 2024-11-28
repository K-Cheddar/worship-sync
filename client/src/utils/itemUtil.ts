import { Cloudinary } from "@cloudinary/url-gen";
import {
  Arrangment,
  FormattedLyrics,
  SongOrder,
  ItemState,
  OptionalItemState,
  Media,
  ServiceItem,
  DBItem,
  DBAllItems,
  verseType,
  ItemList,
  DBItemListDetails,
  DBItemList,
  ItemListDetails,
} from "../types";
import generateRandomId from "./generateRandomId";
import { formatBible, formatSong } from "./overflow";
import { createNewSlide } from "./slideCreation";
import { sortNamesInList } from "./sort";
import { fill } from "@cloudinary/url-gen/actions/resize";

const DEFAULT_SONG_BACKGROUND =
  "https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/WorshipBackground_ycr280?_a=DATAg1AAZAA0";
const DEFAULT_SONG_BRIGHTNESS = 50;

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
  list: ServiceItem[];
  db: PouchDB.Database | undefined;
  selectedList: ItemList;
};

export const createNewSong = async ({
  name,
  formattedLyrics,
  songOrder,
  list,
  db,
  selectedList,
}: CreateNewSongType): Promise<ItemState> => {
  const arrangements: Arrangment[] = [
    {
      name: "Master",
      formattedLyrics,
      songOrder,
      id: generateRandomId(),
      slides: [
        createNewSlide({
          type: "Title",
          fontSize: 4.5,
          words: ["", name],
          background: DEFAULT_SONG_BACKGROUND,
          brightness: DEFAULT_SONG_BRIGHTNESS,
        }),
        createNewSlide({
          type: "Blank",
          fontSize: 2.5,
          words: [""],
          background: DEFAULT_SONG_BACKGROUND,
          brightness: DEFAULT_SONG_BRIGHTNESS,
        }),
      ],
    },
  ];

  const _name = makeUnique({ value: name, property: "name", list });

  const newItem: ItemState = {
    name: _name,
    type: "song",
    _id: _name,
    background: DEFAULT_SONG_BACKGROUND,
    selectedArrangement: 0,
    selectedSlide: 0,
    selectedBox: 1,
    slides: [],
    shouldSkipTitle: false,
    arrangements,
  };

  const item = formatSong(newItem);

  const _item = await createNewItemInDb({ item, db, selectedList });

  return _item;
};

export const createItemFromProps = ({
  name,
  type,
  _id,
  selectedArrangement,
  shouldSkipTitle,
  arrangements,
  selectedSlide,
  selectedBox,
  slides,
}: OptionalItemState): ItemState => {
  const item: ItemState = {
    name,
    type,
    _id: _id || generateRandomId(),
    selectedArrangement: selectedArrangement || 0,
    shouldSkipTitle,
    arrangements: arrangements || [],
    selectedSlide: selectedSlide || 0,
    selectedBox: selectedBox || 1,
    slides: slides || [],
  };

  return item;
};

type CreateNewBibleType = {
  name: string;
  book: string;
  chapter: string;
  version: string;
  verses: verseType[];
  db: PouchDB.Database | undefined;
  list: ServiceItem[];
  selectedList: ItemList;
};

export const createNewBible = async ({
  name,
  book,
  chapter,
  version,
  verses,
  db,
  list,
  selectedList,
}: CreateNewBibleType): Promise<ItemState> => {
  const _name = makeUnique({ value: name, property: "name", list });

  const newItem: ItemState = {
    name,
    type: "bible",
    _id: _name,
    selectedArrangement: 0,
    shouldSkipTitle: false,
    arrangements: [],
    selectedSlide: 0,
    selectedBox: 1,
    slides: [],
  };

  const item = formatBible({
    item: newItem,
    mode: "add",
    book,
    chapter,
    version,
    verses,
  });

  const _item = await createNewItemInDb({ item, db, selectedList });
  return _item;
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

type CreateNewFreeFormType = {
  name: string;
  list: ServiceItem[];
  db: PouchDB.Database | undefined;
  selectedList: ItemList;
};

export const createNewFreeForm = async ({
  name,
  list,
  db,
  selectedList,
}: CreateNewFreeFormType): Promise<ItemState> => {
  const _name = makeUnique({ value: name, property: "name", list });
  const newItem: ItemState = {
    name: _name,
    type: "free",
    _id: _name,
    selectedArrangement: 0,
    selectedSlide: 0,
    selectedBox: 1,
    slides: [
      createNewSlide({ type: "Section", fontSize: 4.5, words: ["", name] }),
      createNewSlide({ type: "Section", fontSize: 2.5, words: [""] }),
    ],
    arrangements: [],
  };

  const item = await createNewItemInDb({ item: newItem, db, selectedList });

  return item;
};

type RetriveImagesProps = {
  backgrounds: Media[];
  cloud: Cloudinary;
};
export const retrieveImages = ({
  backgrounds,
  cloud,
}: RetriveImagesProps): Media[] => {
  const images: Media[] = [];
  for (let i = 0; i < backgrounds.length; i++) {
    let element = backgrounds[i];
    // const image = cloud.image(element.name).resize(fill().width(250));
    let image = "";
    let video;
    if (element.type === "image") {
      image = cloud.image(element.name).toURL();
    }
    if (element.type === "video") {
      video = cloud.video(element.name).toURL();
      const [videoUrl] = video.split("?");
      image = videoUrl + ".png?type=video";
    }

    images.push({
      ...element,
      image,
      video,
      id: generateRandomId(),
    });
  }
  return images;
};

type MakeUniqueType = {
  value: string;
  property: string;
  list: any[];
};

export const makeUnique = ({ value, property, list }: MakeUniqueType) => {
  let element = list.find((e) => e[property] === value);

  if (element) {
    let counter = 1;
    while (true) {
      const _count = counter;
      if (list.find((e) => e[property] === value + ` (${_count})`)) ++counter;
      else {
        return value + ` (${_count})`;
      }
    }
  } else return value;
};

type CreateNewItemInDbType = {
  item: ItemState;
  db: PouchDB.Database | undefined;
  selectedList: ItemList;
};
export const createNewItemInDb = async ({
  item,
  db,
  selectedList,
}: CreateNewItemInDbType): Promise<ItemState> => {
  if (!db) return item;
  try {
    const response: DBItem = await db.get(item._id);
    return {
      ...item,
      _id: response._id,
      name: response.name,
      slides: response.slides,
    };
  } catch (error) {
    // item does not exist
    // db.get('allItems').then((allItems) {
    // 	allItems.items.push(itemObj);
    // 	allItems.items = Sort.sortNamesInList(allItems.items);
    // 	updateState({allItems: allItems.items});
    // 	db.put(allItems);
    // });
    db.put(item);
    return item;
  }
};

type UpdateItemInListType = {
  property: string;
  value: any;
  id: string;
  list: any[];
};

export const updateItemInList = ({
  property,
  value,
  list,
  id,
}: UpdateItemInListType) => {
  return list.map((i) => {
    if (i._id === id) {
      return {
        ...i,
        [property]: value,
      };
    }
    return i;
  });
};

type CreateNewItemList = {
  db: PouchDB.Database | undefined;
  name: string;
  currentLists: ItemList[];
};
export const createNewItemList = async ({
  db,
  name,
  currentLists,
}: CreateNewItemList): Promise<ItemList> => {
  const newName = makeUnique({
    value: name,
    property: "name",
    list: currentLists,
  });
  const list: ItemList = {
    name: newName,
    id: newName,
  };
  if (!db) return list;
  try {
    const response: DBItemListDetails = await db.get(list.id);
    return {
      id: response._id,
      name: response.name,
    };
  } catch (error) {
    db.put(list);
    return { id: list.id, name: list.name };
  }
};

type CreateItemListFromExisting = {
  db: PouchDB.Database | undefined;
  currentLists: ItemList[];
  selectedList: ItemList;
};

export const createItemListFromExisting = async ({
  db,
  currentLists,
  selectedList,
}: CreateItemListFromExisting): Promise<ItemList | null> => {
  if (!db) return null;

  try {
    const response: DBItemListDetails = await db.get(selectedList.id);
    const name = makeUnique({
      value: selectedList.name,
      property: "name",
      list: currentLists,
    });
    const list: ItemListDetails = {
      _id: name,
      name,
      items: response.items,
      overlays: response.overlays,
    };
    db.put(list);
    return { id: list._id, name: list.name };
  } catch (error) {
    console.error(error);
    return null;
  }
};
