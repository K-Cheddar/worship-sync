import type {
  DBAllItems,
  DBCredits,
  DBItem,
  DBItemListDetails,
  DBItemLists,
  DBMedia,
  DBOverlay,
  DBOverlayTemplates,
  DBPreferences,
  ItemSlideType,
  MonitorSettingsType,
  PreferencesType,
  ServiceItem,
  TemplatesByType,
  TimerInfo,
} from "../types";
import { getCreditsDocId } from "../types";
import { DEFAULT_FONT_PX, DEFAULT_TITLE_FONT_PX } from "../constants";

const SOLID_BACKGROUND = "";
const NOW = "2026-01-01T00:00:00.000Z";

type SeedDoc = { _id: string; [key: string]: unknown };

const createTextSlide = ({
  id,
  type,
  name,
  text,
  fontSize,
}: {
  id: string;
  type: ItemSlideType["type"];
  name: string;
  text: string;
  fontSize: number;
}): ItemSlideType => ({
  id,
  type,
  name,
  boxes: [
    {
      id: `${id}-background`,
      words: " ",
      background: SOLID_BACKGROUND,
      height: 100,
      width: 100,
      x: 0,
      y: 0,
      brightness: 100,
      fontColor: "rgba(255, 255, 255, 1)",
      fontSize,
      align: "center",
      shouldKeepAspectRatio: false,
      transparent: false,
      excludeFromOverflow: false,
      topMargin: 0,
      sideMargin: 0,
      slideIndex: 0,
      label: "",
      isBold: false,
      isItalic: false,
    },
    {
      id: `${id}-text`,
      words: text,
      background: "",
      height: 100,
      width: 100,
      x: 0,
      y: 0,
      brightness: 100,
      fontColor: "rgba(255, 255, 255, 1)",
      fontSize,
      align: "center",
      shouldKeepAspectRatio: false,
      transparent: true,
      excludeFromOverflow: false,
      topMargin: 6,
      sideMargin: 8,
      slideIndex: 0,
      label: "",
      isBold: false,
      isItalic: false,
    },
  ],
});

const defaultPreferences: PreferencesType = {
  defaultSongBackground: { background: SOLID_BACKGROUND },
  defaultTimerBackground: { background: SOLID_BACKGROUND },
  defaultBibleBackground: { background: SOLID_BACKGROUND },
  defaultFreeFormBackground: { background: SOLID_BACKGROUND },
  defaultSongBackgroundBrightness: 100,
  defaultTimerBackgroundBrightness: 100,
  defaultBibleBackgroundBrightness: 100,
  defaultFreeFormBackgroundBrightness: 100,
  defaultSlidesPerRow: 4,
  defaultSlidesPerRowMobile: 3,
  defaultSlidesPerRowMusic: 6,
  defaultSlidesPerRowMusicMobile: 3,
  defaultFormattedLyricsPerRow: 4,
  defaultMediaItemsPerRow: 4,
  defaultShouldShowItemEditor: true,
  defaultIsMediaExpanded: false,
  defaultBibleFontMode: "separate",
  defaultFreeFormFontMode: "fit",
};

const defaultMonitorSettings: MonitorSettingsType = {
  showClock: true,
  showTimer: true,
  showNextSlide: false,
  clockFontSize: 75,
  timerFontSize: 75,
  timerId: null,
};

const songDoc: DBItem = {
  _id: "offline-song-gather-together",
  name: "Gather Together",
  type: "song",
  background: SOLID_BACKGROUND,
  selectedArrangement: 0,
  shouldSkipTitle: false,
  arrangements: [
    {
      id: "offline-arrangement-master",
      name: "Master",
      formattedLyrics: [
        {
          id: "offline-song-verse-1",
          type: "Verse",
          name: "Verse 1",
          words: "Verse one line one\nVerse one line two\nVerse one line three",
          slideSpan: 1,
        },
        {
          id: "offline-song-chorus",
          type: "Chorus",
          name: "Chorus",
          words: "Chorus line one\nChorus line two\nChorus line three",
          slideSpan: 1,
        },
      ],
      songOrder: [
        { id: "offline-song-order-1", name: "Verse 1" },
        { id: "offline-song-order-2", name: "Chorus" },
        { id: "offline-song-order-3", name: "Chorus" },
      ],
      slides: [
        createTextSlide({
          id: "offline-song-title-slide",
          type: "Title",
          name: "Title",
          text: "Gather Together",
          fontSize: DEFAULT_TITLE_FONT_PX,
        }),
        createTextSlide({
          id: "offline-song-blank-slide",
          type: "Blank",
          name: "Blank",
          text: "",
          fontSize: DEFAULT_FONT_PX,
        }),
        createTextSlide({
          id: "offline-song-verse-slide",
          type: "Verse",
          name: "Verse 1",
          text: "Verse one line one\nVerse one line two\nVerse one line three",
          fontSize: DEFAULT_FONT_PX,
        }),
        createTextSlide({
          id: "offline-song-chorus-slide",
          type: "Chorus",
          name: "Chorus",
          text: "Chorus line one\nChorus line two\nChorus line three",
          fontSize: DEFAULT_FONT_PX,
        }),
      ],
    },
  ],
  slides: [],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  songMetadata: {
    source: "manual",
    trackName: "Gather Together",
    artistName: "Offline Demo",
    importedAt: NOW,
  },
  createdAt: NOW,
  updatedAt: NOW,
  docType: "item",
};

const welcomeDoc: DBItem = {
  _id: "offline-free-welcome",
  name: "Welcome",
  type: "free",
  background: SOLID_BACKGROUND,
  selectedArrangement: 0,
  arrangements: [],
  slides: [
    createTextSlide({
      id: "offline-welcome-slide",
      type: "Section",
      name: "Section 1",
      text: "Welcome\nService begins soon",
      fontSize: DEFAULT_TITLE_FONT_PX,
    }),
  ],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  createdAt: NOW,
  updatedAt: NOW,
  docType: "item",
};

const timerInfo: TimerInfo = {
  hostId: "offline-guest",
  id: "offline-timer-five-minutes",
  name: "Five Minute Timer",
  duration: 300,
  countdownTime: "",
  timerType: "timer",
  status: "stopped",
  isActive: false,
  remainingTime: 300,
  showMinutesOnly: false,
  color: "#ffffff",
};

const timerDoc: DBItem = {
  _id: "offline-timer-five-minutes",
  name: "Five Minute Timer",
  type: "timer",
  background: SOLID_BACKGROUND,
  selectedArrangement: 0,
  arrangements: [],
  slides: [
    createTextSlide({
      id: "offline-timer-slide",
      type: "Section",
      name: "Timer",
      text: "{{timer}}",
      fontSize: DEFAULT_TITLE_FONT_PX,
    }),
    createTextSlide({
      id: "offline-timer-wrap-slide",
      type: "Section",
      name: "Wrap Up",
      text: "Please wrap up now",
      fontSize: DEFAULT_TITLE_FONT_PX,
    }),
  ],
  timerInfo,
  shouldSendTo: { projector: false, monitor: true, stream: false },
  createdAt: NOW,
  updatedAt: NOW,
  docType: "item",
};

const serviceItems: ServiceItem[] = [
  {
    _id: welcomeDoc._id,
    name: welcomeDoc.name,
    type: welcomeDoc.type,
    background: welcomeDoc.background,
    listId: "offline-list-row-welcome",
  },
  {
    _id: songDoc._id,
    name: songDoc.name,
    type: songDoc.type,
    background: songDoc.background,
    listId: "offline-list-row-song",
  },
  {
    _id: timerDoc._id,
    name: timerDoc.name,
    type: timerDoc.type,
    background: timerDoc.background,
    listId: "offline-list-row-timer",
  },
];

export const createOfflineGuestSeedDocs = (now = new Date().toISOString()) => {
  const outline = { _id: "offline-demo-outline", name: "Offline Demo" };

  const docs: SeedDoc[] = [
    {
      _id: "allItems",
      items: serviceItems,
      createdAt: now,
      updatedAt: now,
      docType: "allItems",
    } satisfies Omit<DBAllItems, "_rev">,
    {
      _id: "ItemLists",
      itemLists: [outline],
      activeList: outline,
      createdAt: now,
      updatedAt: now,
      docType: "itemLists",
    } satisfies Omit<DBItemLists, "_rev">,
    {
      _id: outline._id,
      name: outline.name,
      items: serviceItems,
      overlays: ["offline-service-note"],
      createdAt: now,
      updatedAt: now,
      docType: "itemListDetails",
    } satisfies Omit<DBItemListDetails, "_rev">,
    {
      _id: "preferences",
      preferences: defaultPreferences,
      quickLinks: [],
      monitorSettings: defaultMonitorSettings,
      mediaRouteFolders: {},
      createdAt: now,
      updatedAt: now,
      docType: "preferences",
    } satisfies Omit<DBPreferences, "_rev">,
    {
      _id: "media",
      list: [],
      folders: [],
      createdAt: now,
      updatedAt: now,
      docType: "media",
    } satisfies Omit<DBMedia, "_rev">,
    {
      _id: "overlay-templates",
      templatesByType: {} as TemplatesByType,
      createdAt: now,
      updatedAt: now,
      docType: "overlayTemplates",
    } satisfies Omit<DBOverlayTemplates, "_rev">,
    {
      _id: getCreditsDocId(outline._id),
      outlineId: outline._id,
      creditIds: [],
      createdAt: now,
      updatedAt: now,
      docType: "credits",
    } satisfies Omit<DBCredits, "_rev">,
    {
      _id: "overlay-offline-service-note",
      id: "offline-service-note",
      type: "stick-to-bottom",
      heading: "Offline demo",
      subHeading: "Local changes stay on this device.",
      duration: 8,
      createdAt: now,
      updatedAt: now,
      docType: "overlay",
    } satisfies Omit<DBOverlay, "_rev">,
    { ...songDoc, createdAt: now, updatedAt: now },
    { ...welcomeDoc, createdAt: now, updatedAt: now },
    {
      ...timerDoc,
      timerInfo: { ...timerInfo, hostId: "offline-guest" },
      createdAt: now,
      updatedAt: now,
    },
  ];

  return docs;
};

export const seedOfflineGuestDatabase = async (db: PouchDB.Database) => {
  await db.bulkDocs(createOfflineGuestSeedDocs());
};
