import {
  Arrangment,
  FormattedLyrics,
  SongOrder,
  ItemState,
  MediaType,
  ServiceItem,
  DBItem,
  DBHeading,
  verseType,
  ItemList,
  DBItemListDetails,
  TimerType,
  TimerStatus,
  BibleFontMode,
  BibleInfo,
  OverflowMode,
  ItemListDetails,
  DBOverlay,
} from "../types";
import generateRandomId from "./generateRandomId";
import { formatBible, formatFree, formatSong } from "./overflow";
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
  list: ServiceItem[];
  db: PouchDB.Database | undefined;
  background: string;
  mediaInfo?: MediaType;
  brightness: number;
};

export const createNewSong = async ({
  name,
  formattedLyrics,
  songOrder,
  list,
  db,
  background,
  mediaInfo,
  brightness,
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
          background,
          mediaInfo,
          brightness,
        }),
        createNewSlide({
          type: "Blank",
          fontSize: 2.5,
          words: [""],
          background,
          mediaInfo,
          brightness,
        }),
      ],
    },
  ];

  const _name = makeUnique({ value: name, property: "name", list });

  const newItem: ItemState = {
    name: _name,
    type: "song",
    _id: _name,
    background:
      mediaInfo?.type === "video" ? mediaInfo?.placeholderImage : background,
    selectedArrangement: 0,
    selectedSlide: 0,
    selectedBox: 1,
    slides: [],
    shouldSkipTitle: false,
    arrangements,
    shouldSendTo: {
      projector: true,
      monitor: true,
      stream: true,
    },
  };

  const item = formatSong(newItem);

  const _item = await createNewItemInDb({ item, db });

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
}: Partial<ItemState>): ItemState => {
  const item: ItemState = {
    name: name || "",
    type: type || "song",
    _id: _id || generateRandomId(),
    selectedArrangement: selectedArrangement || 0,
    shouldSkipTitle,
    arrangements: arrangements || [],
    selectedSlide: selectedSlide || 0,
    selectedBox: selectedBox || 1,
    slides: slides || [],
    shouldSendTo: {
      projector: true,
      monitor: true,
      stream: true,
    },
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
  background: string;
  mediaInfo?: MediaType;
  brightness: number;
  fontMode: BibleFontMode;
};

export const createNewBible = async ({
  name,
  book,
  chapter,
  version,
  verses,
  db,
  list,
  background,
  mediaInfo,
  brightness,
  fontMode,
}: CreateNewBibleType): Promise<ItemState> => {
  const _name = makeUnique({ value: name, property: "name", list });

  const newItem: ItemState = {
    name,
    type: "bible",
    _id: _name,
    selectedArrangement: 0,
    shouldSkipTitle: false,
    arrangements: [],
    selectedSlide: 1,
    selectedBox: 1,
    slides: [],
    shouldSendTo: {
      projector: true,
      monitor: true,
      stream: true,
    },
    background:
      mediaInfo?.type === "video" ? mediaInfo?.placeholderImage : background,
  };

  const item = formatBibleFromScratch({
    item: newItem,
    book,
    chapter,
    version,
    verses,
    mode: fontMode,
    background,
    mediaInfo,
    brightness,
  });

  const _item = await createNewItemInDb({ item, db });
  return _item;
};

type FormatBibleFromScratchType = {
  item: ItemState;
  book: string;
  chapter: string;
  version: string;
  verses: verseType[];
  mode: BibleFontMode;
  background: string;
  mediaInfo?: MediaType;
  brightness?: number;
};

export const formatBibleFromScratch = ({
  item,
  book,
  chapter,
  version,
  verses,
  mode,
  background,
  mediaInfo,
  brightness,
}: FormatBibleFromScratchType): ItemState =>
  formatBible({
    item,
    mode,
    verses,
    book,
    chapter,
    version,
    background,
    mediaInfo,
    brightness,
    isNew: true,
  });

export const getBibleVerseRange = (
  bibleInfo: BibleInfo | undefined,
): { startVerse: number; endVerse: number } => {
  if (!bibleInfo?.verses?.length) return { startVerse: 0, endVerse: 0 };
  return {
    startVerse: bibleInfo.verses[0].index,
    endVerse: bibleInfo.verses[bibleInfo.verses.length - 1].index,
  };
};

export const getBibleItemName = (
  book: string,
  chapter: string,
  verses: verseType[],
  version: string,
): string => {
  if (!verses?.length) return `${book} ${chapter} ${version.toUpperCase()}`;
  const startName = verses[0].name;
  const endName = verses[verses.length - 1].name;
  const verseRange =
    startName === endName ? startName : `${startName} - ${endName}`;
  return `${book} ${chapter}:${verseRange} ${version.toUpperCase()}`;
};

export const buildBibleOpenAtSearchParams = (
  bibleInfo: BibleInfo | undefined,
): URLSearchParams | null => {
  if (!bibleInfo?.book || !bibleInfo?.chapter || !bibleInfo?.version)
    return null;
  return new URLSearchParams({
    book: bibleInfo.book,
    chapter: bibleInfo.chapter,
    version: bibleInfo.version,
  });
};

type FormatBibleItemForVersionType = {
  item: ItemState;
  newVersion: string;
  newVerses: verseType[];
};
export const formatBibleItemForVersion = ({
  item,
  newVersion,
  newVerses,
}: FormatBibleItemForVersionType): ItemState | null => {
  const bibleInfo = item.bibleInfo;
  if (!bibleInfo?.book || !bibleInfo?.chapter) return null;
  const { startVerse, endVerse } = getBibleVerseRange(bibleInfo);
  const versesToUse = newVerses.filter(
    (v) => v.index >= startVerse && v.index <= endVerse,
  );
  const verses = versesToUse.length ? versesToUse : newVerses;
  const newName = getBibleItemName(
    bibleInfo.book,
    bibleInfo.chapter,
    verses,
    newVersion,
  );
  const firstBox = item.slides?.[0]?.boxes?.[0];
  return formatBibleFromScratch({
    item: { ...item, name: newName, slides: [] },
    book: bibleInfo.book,
    chapter: bibleInfo.chapter,
    version: newVersion,
    verses,
    mode: bibleInfo.fontMode,
    background: firstBox?.background ?? item.background ?? "",
    mediaInfo: firstBox?.mediaInfo,
    brightness: firstBox?.brightness,
  });
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

  const sections: string[] = [];
  const sectionUpdates: any = {};
  const sectionCounter: any = {};

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
    const type = formattedLyrics[i].type;
    const max = sectionCounter[type];
    const counter = sectionCounter[type + "_counter"];
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
    const section = songOrder[i];
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
  text: string;
  list: ServiceItem[];
  db: PouchDB.Database | undefined;
  background: string;
  brightness: number;
  mediaInfo?: MediaType;
  overflow?: OverflowMode;
};

export const createNewFreeForm = async ({
  name,
  text,
  list,
  db,
  background,
  mediaInfo,
  brightness,
  overflow = "fit",
}: CreateNewFreeFormType): Promise<ItemState> => {
  const _name = makeUnique({ value: name, property: "name", list });
  const newItem: ItemState = {
    name: _name,
    type: "free",
    _id: _name,
    selectedArrangement: 0,
    selectedSlide: 0,
    selectedBox: 1,
    background:
      mediaInfo?.type === "video" ? mediaInfo?.placeholderImage : background,
    slides: [
      createNewSlide({
        type: "Section",
        name: "Section 1",
        fontSize: 2.5,
        words: ["", text || name],
        background,
        mediaInfo,
        brightness,
        overflow,
      }),
    ],
    arrangements: [],
    shouldSendTo: {
      projector: true,
      monitor: true,
      stream: true,
    },
  };

  const formattedItem = formatFree(newItem);

  const item = await createNewItemInDb({ item: formattedItem, db });

  return item;
};

type CreateNewTimerType = {
  name: string;
  list: ServiceItem[];
  db: PouchDB.Database | undefined;
  hostId: string;
  duration: number;
  countdownTime: string;
  timerType: TimerType;
  background: string;
  mediaInfo?: MediaType;
  brightness: number;
};

export const createNewTimer = async ({
  name,
  list,
  db,
  hostId,
  duration,
  countdownTime,
  timerType,
  background,
  mediaInfo,
  brightness,
}: CreateNewTimerType): Promise<ItemState> => {
  const _name = makeUnique({ value: name, property: "name", list });

  // Calculate end time for timer type
  const endTime =
    timerType === "timer" && duration
      ? new Date(Date.now() + duration * 1000).toISOString()
      : undefined;

  // Default timer color (white)
  const defaultTimerColor = "#ffffff";

  // Create first slide with timer
  const timerSlide = createNewSlide({
    type: "Section",
    fontSize: 4.5,
    words: ["", "{{timer}}"],
    background,
    mediaInfo,
    brightness,
  });

  // Create second slide with "Please wrap up now" where "now" is in timer color
  // Use Zero Width Non-Joiner (\u200C) to mark "now" for special styling
  const wrapUpSlide = createNewSlide({
    type: "Section",
    fontSize: 4.5,
    words: ["", "Please wrap up \u200Cnow\u200C"],
    background,
    mediaInfo,
    brightness,
  });

  const newItem: ItemState = {
    name: _name,
    type: "timer",
    _id: _name,
    selectedArrangement: 0,
    selectedSlide: 0,
    selectedBox: 1,
    background:
      mediaInfo?.type === "video" ? mediaInfo?.placeholderImage : background,
    slides: [timerSlide, wrapUpSlide],
    arrangements: [],
    timerInfo: {
      hostId: hostId,
      duration,
      countdownTime,
      timerType,
      status: "stopped" as TimerStatus,
      isActive: false,
      remainingTime: duration || 0,
      id: _name,
      name: name,
      startedAt: undefined,
      endTime,
      showMinutesOnly: false,
      color: defaultTimerColor,
    },
    shouldSendTo: {
      projector: false,
      monitor: true,
      stream: false,
    },
  };

  const item = await createNewItemInDb({ item: newItem, db });

  return item;
};

type RetriveImagesProps = {
  backgrounds: MediaType[];
};
export const retrieveImages = ({
  backgrounds,
}: RetriveImagesProps): MediaType[] => {
  const images: MediaType[] = [];
  for (let i = 0; i < backgrounds.length; i++) {
    const element = backgrounds[i];

    images.push({
      ...element,
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
  const element = list.find((e) => e[property] === value);

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
};
export const createNewItemInDb = async ({
  item,
  db,
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
    db.put({
      ...item,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return item;
  }
};

type CreateNewHeadingType = {
  name: string;
  list: ServiceItem[];
  db: PouchDB.Database | undefined;
};

export type NewHeadingResult = {
  name: string;
  _id: string;
  type: "heading";
};

export const createNewHeading = async ({
  name,
  list,
  db,
}: CreateNewHeadingType): Promise<NewHeadingResult> => {
  const _name = makeUnique({ value: name, property: "name", list });
  const _id = `heading-${generateRandomId()}`;

  const doc: DBHeading = {
    _id,
    name: _name,
    type: "heading",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (db) {
    await db.put(doc);
  }

  return { name: _name, _id, type: "heading" };
};

type UpdateHeadingNameType = {
  db: PouchDB.Database | undefined;
  headingId: string;
  newName: string;
};

export const updateHeadingName = async ({
  db,
  headingId,
  newName,
}: UpdateHeadingNameType): Promise<void> => {
  if (!db) return;
  let doc: DBHeading;
  try {
    doc = (await db.get(headingId)) as DBHeading;
  } catch {
    return;
  }
  if (!doc || doc.type !== "heading") return;
  await db.put({
    ...doc,
    name: newName,
    updatedAt: new Date().toISOString(),
  });
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
  const _id = makeUnique({
    value: newName,
    property: "_id",
    list: currentLists,
  });
  const list: ItemListDetails = {
    name: newName,
    _id,
    items: [],
    overlays: [],
  };
  if (!db) return list;
  try {
    const response: DBItemListDetails = await db.get(list._id);
    return {
      _id: response._id,
      name: response.name,
    };
  } catch (error) {
    db.put({
      ...list,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { _id: list._id, name: list.name };
  }
};

type CreateItemListFromExisting = {
  db: PouchDB.Database | undefined;
  currentLists: ItemList[];
  list: ItemList;
};

export const createItemListFromExisting = async ({
  db,
  currentLists,
  list,
}: CreateItemListFromExisting): Promise<ItemList | null> => {
  if (!db) return null;

  try {
    const response: DBItemListDetails = await db.get(list._id);
    const name = makeUnique({
      value: list.name,
      property: "name",
      list: currentLists,
    });
    const _id = makeUnique({
      value: list._id,
      property: "_id",
      list: currentLists,
    });
    const newOverlays: string[] = [];
    for (const overlayId of response.overlays) {
      const { _id, _rev, ...overlayDetails }: DBOverlay | undefined =
        await db.get(`overlay-${overlayId}`);

      const newId = generateRandomId();
      const copiedOverlay = {
        ...overlayDetails,
        id: newId,
        _id: `overlay-${newId}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await db.put(copiedOverlay);

      newOverlays.push(newId);
    }
    const newList: ItemListDetails = {
      _id,
      name,
      items: response.items,
      overlays: newOverlays,
    };
    db.put({
      ...newList,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { _id: newList._id, name: newList.name };
  } catch (error) {
    console.error(error);
    return null;
  }
};
