import { DEFAULT_FONT_PX, DEFAULT_TITLE_FONT_PX } from "../constants";
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
  SongMetadata,
} from "../types";
import generateRandomId from "./generateRandomId";
import { applyPouchAudit } from "./pouchAudit";
import { formatBible, formatFree, formatSong } from "./overflow";
import { createNewSlide } from "./slideCreation";
import { sortNamesInList } from "./sort";

type CreateSectionsType = {
  formattedLyrics?: FormattedLyrics[];
  songOrder?: SongOrder[];
  unformattedLyrics: string;
};

const SECTION_LABEL_MAP: Record<string, string> = {
  verse: "Verse",
  chorus: "Chorus",
  "pre-chorus": "Pre-Chorus",
  prechorus: "Pre-Chorus",
  "pre chorus": "Pre-Chorus",
  bridge: "Bridge",
  intro: "Intro",
  outro: "Outro",
  tag: "Tag",
  interlude: "Interlude",
  hook: "Hook",
  refrain: "Refrain",
  vamp: "Vamp",
  instrumental: "Instrumental",
};

const WRAPPED_LABEL_RE = /^[[(]([^\])]*)[\])]$/;

const tryParseSectionLabel = (rawLine: string): string | null => {
  const line = rawLine.trim();
  const wrappedMatch = line.match(WRAPPED_LABEL_RE);
  const inner = wrappedMatch ? wrappedMatch[1].trim() : line;
  // Strip trailing number so "VERSE 1" → base "VERSE"
  const base = inner.replace(/\s+\d+$/, "").trim();
  return SECTION_LABEL_MAP[base.toLowerCase()] ?? null;
};

const normalizeLyricsText = (text: string): string =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

type ParsedSection = { type: string; words: string };

const parseWithSectionLabels = (normalizedText: string): ParsedSection[] => {
  const lines = normalizedText.split("\n");
  const sections: ParsedSection[] = [];
  let currentType: string | null = null;
  let contentLines: string[] = [];

  const flush = () => {
    if (currentType !== null) {
      sections.push({
        type: currentType,
        words: contentLines
          .join("\n")
          .replace(/\n{2,}/g, "\n")
          .trim(),
      });
      contentLines = [];
    }
  };

  for (const line of lines) {
    const labelType = tryParseSectionLabel(line);
    if (labelType !== null) {
      flush();
      currentType = labelType;
    } else if (currentType !== null) {
      contentLines.push(line);
    }
  }
  flush();

  return sections;
};

const parseSectionBlock = (block: string): ParsedSection => {
  const newlineIndex = block.indexOf("\n");
  if (newlineIndex !== -1) {
    const firstLine = block.slice(0, newlineIndex).trim();
    const canonical = SECTION_LABEL_MAP[firstLine.toLowerCase()];
    if (canonical) {
      return {
        type: canonical,
        words: block.slice(newlineIndex + 1).trimStart(),
      };
    }
  }
  return { type: "Verse", words: block };
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

  const normalizedText = normalizeLyricsText(unformattedLyrics);

  const hasSectionLabels = normalizedText
    .split("\n")
    .some((line) => tryParseSectionLabel(line) !== null);

  const parsedSections: ParsedSection[] = hasSectionLabels
    ? parseWithSectionLabels(normalizedText)
    : normalizedText.split("\n\n").map(parseSectionBlock);

  for (const { type, words } of parsedSections) {
    const name = type + " " + (newLyrics.length === 0 ? "" : newLyrics.length);

    if (words === "") {
      // Empty-content label → repeat the most recently defined section of this type
      const existing = [...newLyrics].reverse().find((e) => e.type === type);
      if (existing) {
        newSongOrder.push({ name: existing.name, id: generateRandomId() });
      }
      continue;
    }

    const index = newLyrics.findIndex((e) => e.words === words);
    if (index === -1) {
      newLyrics.push({
        type,
        name,
        words,
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
  songMetadata?: SongMetadata | null;
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
  songMetadata,
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
          fontSize: DEFAULT_TITLE_FONT_PX,
          textBoxHeight: 55,
          words: ["", name],
          background,
          mediaInfo,
          brightness,
        }),
        createNewSlide({
          type: "Blank",
          fontSize: DEFAULT_FONT_PX,
          textBoxHeight: 55,
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
    songMetadata: songMetadata || undefined,
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
  songMetadata,
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
    songMetadata,
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
  /** When true, keeps existing box layout (e.g. when changing version). */
  preserveLayout?: boolean;
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
  preserveLayout,
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
    isNew: !preserveLayout,
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
  const existingSlides = item.slides ?? [];
  const slidesToUse =
    existingSlides.length > 0
      ? existingSlides.map((slide, i) =>
          i === 0 && slide.boxes?.[1]
            ? {
                ...slide,
                boxes: slide.boxes.map((b, j) =>
                  j === 1 ? { ...b, words: newName } : b,
                ),
              }
            : slide,
        )
      : [];
  return formatBibleFromScratch({
    item: { ...item, name: newName, slides: slidesToUse },
    book: bibleInfo.book,
    chapter: bibleInfo.chapter,
    version: newVersion,
    verses,
    mode: bibleInfo.fontMode,
    background: firstBox?.background ?? item.background ?? "",
    mediaInfo: firstBox?.mediaInfo,
    brightness: firstBox?.brightness,
    preserveLayout: slidesToUse.length > 0,
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
  /** When true, first slide body stays empty (no `text || name` fallback). */
  emptyBodyText?: boolean;
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
  emptyBodyText = false,
}: CreateNewFreeFormType): Promise<ItemState> => {
  const _name = makeUnique({ value: name, property: "name", list });
  const bodyWords: [string, string] = emptyBodyText
    ? ["", ""]
    : ["", text || name];
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
        fontSize: DEFAULT_FONT_PX,
        words: bodyWords,
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
    fontSize: DEFAULT_TITLE_FONT_PX,
    words: ["", "{{timer}}"],
    background,
    mediaInfo,
    brightness,
  });

  // Create second slide with "Please wrap up now" where "now" is in timer color
  // Use Zero Width Non-Joiner (\u200C) to mark "now" for special styling
  const wrapUpSlide = createNewSlide({
    type: "Section",
    fontSize: DEFAULT_TITLE_FONT_PX,
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
    const now = new Date().toISOString();
    const doc = applyPouchAudit(
      null,
      { ...item, createdAt: now, updatedAt: now },
      { isNew: true },
    );
    db.put(doc);
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
