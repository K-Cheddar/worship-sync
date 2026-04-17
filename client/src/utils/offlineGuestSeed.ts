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
  DBQuickLinksDoc,
  DBMonitorSettingsDoc,
  DBMediaRouteFoldersDoc,
  ItemSlideType,
  MonitorSettingsType,
  PreferencesType,
  ServiceItem,
  TemplatesByType,
  TimerInfo,
  MediaType,
  Presentation,
  QuickLinkType,
} from "../types";
import {
  getCreditsDocId,
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
} from "../types";
import { DEFAULT_FONT_PX, DEFAULT_TITLE_FONT_PX } from "../constants";
import { presentationFromOverlayInfo } from "./quickLinkOverlayPresentation";

const SOLID_BACKGROUND = "";
const NOW = "2026-01-01T00:00:00.000Z";

/** Read-only demo image URLs for guest item + slide backdrops (delivery only, not uploads). */
const GUEST_BG_WORSHIP =
  "https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/WorshipBackground_ycr280";
const GUEST_BG_BIBLE =
  "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/bible-background_mlek3e";
const GUEST_BG_SIMPLE =
  "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/simple-background-2048x1152_zj96ie";
const GUEST_BG_CROSSES =
  "https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/14404-jesus-sky-easter-three-crosses-sunrise-sunset-dark-wide.1200w.tn_opp803";

const guestCldV1 = (publicId: string) =>
  `https://res.cloudinary.com/portable-media/image/upload/v1/${publicId}`;
const guestCldThumb250 = (publicId: string) =>
  `https://res.cloudinary.com/portable-media/image/upload/c_fill,w_250/v1/${publicId}?_a=DATAg1AAZAA0`;

const GUEST_MEDIA_PUBLIC = {
  powerOfPrayer: "eliathah/The-Power-of-Prayer_gn6ueo",
  delightInPrayer: "backgrounds/CCF_IMG_Delight-in-Prayer-2560x1440_ocskny",
  createdToWorship: "backgrounds/Created-To-Woship-Slide_miaqvs",
  welcomeChurchWide: "backgrounds/welcome-to-our-church-wide-t_nnxdv9",
} as const;

/** Welcome item: image only (no on-slide text). */
const GUEST_BG_WELCOME_CHURCH = guestCldV1(
  GUEST_MEDIA_PUBLIC.welcomeChurchWide,
);

type SeedDoc = { _id: string; [key: string]: unknown };

const createTextSlide = ({
  id,
  type,
  name,
  text,
  fontSize,
  slideBackgroundUrl,
  textFontColor,
}: {
  id: string;
  type: ItemSlideType["type"];
  name: string;
  text: string;
  fontSize: number;
  /** Full-bleed backdrop for the slide (guest demo uses shared Cloudinary delivery URLs). */
  slideBackgroundUrl?: string;
  /** Text box color (defaults to white). */
  textFontColor?: string;
}): ItemSlideType => ({
  id,
  type,
  name,
  boxes: [
    {
      id: `${id}-background`,
      words: " ",
      background: slideBackgroundUrl ?? SOLID_BACKGROUND,
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
      fontColor: textFontColor ?? "rgba(255, 255, 255, 1)",
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

/** Compact demo songs for guest seed (same shape as a typical imported song). */
const buildDemoSong = (p: {
  _id: string;
  name: string;
  verse: string;
  chorus: string;
  artistName?: string;
  itemBackground: string;
}): DBItem => ({
  _id: p._id,
  name: p.name,
  type: "song",
  background: p.itemBackground,
  selectedArrangement: 0,
  shouldSkipTitle: false,
  arrangements: [
    {
      id: `${p._id}-arr`,
      name: "Master",
      formattedLyrics: [
        {
          id: `${p._id}-fl-v`,
          type: "Verse",
          name: "Verse 1",
          words: p.verse,
          slideSpan: 1,
        },
        {
          id: `${p._id}-fl-c`,
          type: "Chorus",
          name: "Chorus",
          words: p.chorus,
          slideSpan: 1,
        },
      ],
      songOrder: [
        { id: `${p._id}-so-1`, name: "Verse 1" },
        { id: `${p._id}-so-2`, name: "Chorus" },
        { id: `${p._id}-so-3`, name: "Chorus" },
      ],
      slides: [
        createTextSlide({
          id: `${p._id}-title`,
          type: "Title",
          name: "Title",
          text: p.name,
          fontSize: DEFAULT_TITLE_FONT_PX,
          slideBackgroundUrl: p.itemBackground,
        }),
        createTextSlide({
          id: `${p._id}-vslide`,
          type: "Verse",
          name: "Verse 1",
          text: p.verse,
          fontSize: DEFAULT_FONT_PX,
          slideBackgroundUrl: p.itemBackground,
        }),
        createTextSlide({
          id: `${p._id}-cslide`,
          type: "Chorus",
          name: "Chorus",
          text: p.chorus,
          fontSize: DEFAULT_FONT_PX,
          slideBackgroundUrl: p.itemBackground,
        }),
        createTextSlide({
          id: `${p._id}-blank`,
          type: "Blank",
          name: "Blank",
          text: "",
          fontSize: DEFAULT_FONT_PX,
          slideBackgroundUrl: p.itemBackground,
        }),
      ],
    },
  ],
  slides: [],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  songMetadata: {
    source: "manual",
    trackName: p.name,
    artistName: p.artistName ?? "Sample artist",
    importedAt: NOW,
  },
  createdAt: NOW,
  updatedAt: NOW,
  docType: "item",
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

const songGatherDoc = buildDemoSong({
  _id: "offline-song-gather-together",
  name: "Gather Together",
  verse: "Verse one line one\nVerse one line two\nVerse one line three",
  chorus: "Chorus line one\nChorus line two\nChorus line three",
  artistName: "Offline Demo",
  itemBackground: GUEST_BG_WORSHIP,
});

const songHowGreatDoc = buildDemoSong({
  _id: "offline-song-how-great-thou-art",
  name: "How Great Thou Art",
  verse:
    "O Lord my God, when I in awesome wonder\nConsider all the worlds Thy hands have made",
  chorus:
    "Then sings my soul, my Savior God, to Thee\nHow great Thou art, how great Thou art",
  artistName: "Stuart K. Hine",
  itemBackground: GUEST_BG_BIBLE,
});

const songGreatAreYouDoc = buildDemoSong({
  _id: "offline-song-great-are-you-lord",
  name: "Great Are You Lord",
  verse: "You give life, You are love\nYou bring light to the darkness",
  chorus: "Holy, holy, holy\nIs Your name",
  artistName: "All Sons & Daughters",
  itemBackground: GUEST_BG_CROSSES,
});

const welcomeDoc: DBItem = {
  _id: "offline-free-welcome",
  name: "Welcome",
  type: "free",
  background: GUEST_BG_WELCOME_CHURCH,
  selectedArrangement: 0,
  arrangements: [],
  slides: [
    createTextSlide({
      id: "offline-welcome-slide",
      type: "Section",
      name: "Welcome",
      text: "",
      fontSize: DEFAULT_TITLE_FONT_PX,
      slideBackgroundUrl: GUEST_BG_WELCOME_CHURCH,
    }),
  ],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  createdAt: NOW,
  updatedAt: NOW,
  docType: "item",
};

const announcementsDoc: DBItem = {
  _id: "offline-free-announcements",
  name: "Announcements",
  type: "free",
  background: GUEST_BG_SIMPLE,
  selectedArrangement: 0,
  arrangements: [],
  slides: [
    createTextSlide({
      id: "offline-announcements-slide-a",
      type: "Section",
      name: "This week",
      text: "Community dinner — Friday 6:00 PM\nNew volunteers: see the welcome desk",
      fontSize: DEFAULT_TITLE_FONT_PX,
      slideBackgroundUrl: GUEST_BG_SIMPLE,
    }),
    createTextSlide({
      id: "offline-announcements-slide-b",
      type: "Section",
      name: "Giving",
      text: "Thank you for supporting the mission of our church",
      fontSize: DEFAULT_FONT_PX,
      slideBackgroundUrl: GUEST_BG_SIMPLE,
    }),
  ],
  shouldSendTo: { projector: true, monitor: true, stream: true },
  createdAt: NOW,
  updatedAt: NOW,
  docType: "item",
};

const GUEST_TIMER_TEXT_YELLOW = "#facc15";

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
  color: GUEST_TIMER_TEXT_YELLOW,
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
      fontSize: 200,
      textFontColor: GUEST_TIMER_TEXT_YELLOW,
    }),
    createTextSlide({
      id: "offline-timer-wrap-slide",
      type: "Section",
      name: "Wrap Up",
      text: "Please wrap up now",
      fontSize: 96,
      textFontColor: GUEST_TIMER_TEXT_YELLOW,
    }),
  ],
  timerInfo,
  shouldSendTo: { projector: false, monitor: true, stream: false },
  createdAt: NOW,
  updatedAt: NOW,
  docType: "item",
};

/** Sample library images (read-only URLs; no `source` so guests never call provider delete APIs). */
const buildGuestSampleMedia = (iso: string): MediaType[] => {
  const thumb = (publicId: string) =>
    `https://res.cloudinary.com/portable-media/image/upload/c_fill,h_158,w_280,q_auto,f_auto/v1/${publicId}`;
  const row = (
    id: string,
    name: string,
    publicId: string,
    w: number,
    h: number,
    thumbnailUrl?: string,
  ): MediaType => ({
    id,
    name,
    type: "image",
    publicId,
    path: "",
    background: guestCldV1(publicId),
    thumbnail: thumbnailUrl ?? thumb(publicId),
    createdAt: iso,
    updatedAt: iso,
    format: "jpg",
    height: h,
    width: w,
    placeholderImage: "",
  });

  return [
    row(
      "guest-media-worship-bg",
      "Worship wash backdrop",
      "eliathah/WorshipBackground_ycr280",
      1920,
      1080,
    ),
    row(
      "guest-media-bible-scene",
      "Bible scene",
      "backgrounds/bible-background_mlek3e",
      1920,
      1080,
    ),
    row(
      "guest-media-simple-wide",
      "Simple gradient wide",
      "backgrounds/simple-background-2048x1152_zj96ie",
      2048,
      1152,
    ),
    row(
      "guest-media-crosses-sky",
      "Three crosses at sunrise",
      "eliathah/14404-jesus-sky-easter-three-crosses-sunrise-sunset-dark-wide.1200w.tn_opp803",
      1200,
      675,
    ),
    row(
      "guest-media-power-of-prayer",
      "The Power of Prayer",
      GUEST_MEDIA_PUBLIC.powerOfPrayer,
      1920,
      1080,
      guestCldThumb250(GUEST_MEDIA_PUBLIC.powerOfPrayer),
    ),
    row(
      "guest-media-delight-in-prayer",
      "Delight in Prayer",
      GUEST_MEDIA_PUBLIC.delightInPrayer,
      2560,
      1440,
      guestCldThumb250(GUEST_MEDIA_PUBLIC.delightInPrayer),
    ),
    row(
      "guest-media-created-to-worship",
      "Created To Worship",
      GUEST_MEDIA_PUBLIC.createdToWorship,
      1920,
      1080,
      guestCldThumb250(GUEST_MEDIA_PUBLIC.createdToWorship),
    ),
    row(
      "guest-media-welcome-church-wide",
      "Welcome to our church",
      GUEST_MEDIA_PUBLIC.welcomeChurchWide,
      1920,
      1080,
      guestCldThumb250(GUEST_MEDIA_PUBLIC.welcomeChurchWide),
    ),
  ];
};

const guestProjectorMediaPresentation = (
  label: string,
  media: MediaType,
): Presentation => ({
  type: "media",
  name: label,
  slide: {
    type: "Media",
    name: "",
    id: `guest-ql-media-slide-${media.id}`,
    boxes: [
      {
        id: `guest-ql-media-box-${media.id}`,
        background: media.background,
        mediaInfo: media,
        height: 100,
        width: 100,
      },
    ],
  },
});

const GUEST_OUTLINE_OVERLAY_IDS = [
  "offline-service-note",
  "offline-welcome-strap",
  "offline-speaker-card",
  "offline-connect-qr",
  "offline-title-card",
] as const;

const guestItemDocs: DBItem[] = [
  welcomeDoc,
  announcementsDoc,
  songGatherDoc,
  songHowGreatDoc,
  songGreatAreYouDoc,
  timerDoc,
];

const serviceItemsFromGuests = (items: DBItem[]): ServiceItem[] =>
  items.map((doc) => ({
    _id: doc._id,
    name: doc.name,
    type: doc.type,
    background: doc.background ?? SOLID_BACKGROUND,
    listId: `offline-list-${doc._id}`,
  }));

/** Preferences quick links: two projector media links, monitor timer, three stream overlays. */
const buildGuestQuickLinks = (mediaList: MediaType[]): QuickLinkType[] => {
  const powerMedia = mediaList.find(
    (m) => m.id === "guest-media-power-of-prayer",
  );
  const delightMedia = mediaList.find(
    (m) => m.id === "guest-media-delight-in-prayer",
  );
  if (!powerMedia || !delightMedia) {
    throw new Error(
      "Guest seed: expected projector quick link media rows missing",
    );
  }
  const timerSlide = timerDoc.slides![0];
  return [
    {
      id: "guest-ql-projector-power-of-prayer",
      label: "Power prayer",
      displayType: "projector",
      linkType: "media",
      canDelete: false,
      presentationInfo: guestProjectorMediaPresentation(
        "Power prayer",
        powerMedia,
      ),
    },
    {
      id: "guest-ql-projector-delight-in-prayer",
      label: "Delight prayer",
      displayType: "projector",
      linkType: "media",
      canDelete: false,
      presentationInfo: guestProjectorMediaPresentation(
        "Delight prayer",
        delightMedia,
      ),
    },
    {
      id: "guest-ql-monitor-five-minute-timer",
      label: "Timer",
      displayType: "monitor",
      linkType: "slide",
      canDelete: false,
      presentationInfo: {
        type: "timer",
        name: "Timer",
        slide: timerSlide,
        timerId: timerInfo.id,
        itemId: timerDoc._id,
        displayType: "monitor",
      },
    },
    {
      id: "guest-ql-stream-welcome-strap",
      label: "Welcome bar",
      displayType: "stream",
      linkType: "overlay",
      canDelete: false,
      presentationInfo: {
        ...presentationFromOverlayInfo({
          id: "offline-welcome-strap",
          type: "stick-to-bottom",
          heading: "Welcome",
          subHeading: "We're glad you're here",
          duration: 10,
        }),
        name: "Welcome bar",
      },
    },
    {
      id: "guest-ql-stream-speaker",
      label: "Speaker",
      displayType: "stream",
      linkType: "overlay",
      canDelete: false,
      presentationInfo: {
        ...presentationFromOverlayInfo({
          id: "offline-speaker-card",
          type: "participant",
          name: "Jordan Lee",
          title: "Teaching Pastor",
          event: "Sunday gathering",
          duration: 12,
        }),
        name: "Speaker",
      },
    },
    {
      id: "guest-ql-stream-guest-note",
      label: "Guest note",
      displayType: "stream",
      linkType: "overlay",
      canDelete: false,
      presentationInfo: {
        ...presentationFromOverlayInfo({
          id: "offline-service-note",
          type: "stick-to-bottom",
          heading: "Guest mode",
          subHeading: "Sample content — sign in to sync with your team.",
          duration: 8,
        }),
        name: "Guest note",
      },
    },
  ];
};

export const createOfflineGuestSeedDocs = (now = new Date().toISOString()) => {
  const outline = { _id: "offline-demo-outline", name: "Sample service" };
  const serviceItems = serviceItemsFromGuests(guestItemDocs);
  const guestMediaList = buildGuestSampleMedia(now);
  const guestQuickLinks = buildGuestQuickLinks(guestMediaList);

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
      overlays: [...GUEST_OUTLINE_OVERLAY_IDS],
      createdAt: now,
      updatedAt: now,
      docType: "itemListDetails",
    } satisfies Omit<DBItemListDetails, "_rev">,
    {
      _id: PREFERENCES_POUCH_ID,
      preferences: defaultPreferences,
      createdAt: now,
      updatedAt: now,
      docType: "preferences",
    } satisfies Omit<DBPreferences, "_rev">,
    {
      _id: QUICK_LINKS_POUCH_ID,
      quickLinks: guestQuickLinks,
      createdAt: now,
      updatedAt: now,
      docType: "quickLinks",
    } satisfies Omit<DBQuickLinksDoc, "_rev">,
    {
      _id: MONITOR_SETTINGS_POUCH_ID,
      monitorSettings: defaultMonitorSettings,
      createdAt: now,
      updatedAt: now,
      docType: "monitorSettings",
    } satisfies Omit<DBMonitorSettingsDoc, "_rev">,
    {
      _id: MEDIA_ROUTE_FOLDERS_POUCH_ID,
      mediaRouteFolders: {},
      createdAt: now,
      updatedAt: now,
      docType: "mediaRouteFolders",
    } satisfies Omit<DBMediaRouteFoldersDoc, "_rev">,
    {
      _id: "media",
      list: guestMediaList,
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
      heading: "Guest mode",
      subHeading: "Sample content — sign in to sync with your team.",
      duration: 8,
      createdAt: now,
      updatedAt: now,
      docType: "overlay",
    } satisfies Omit<DBOverlay, "_rev">,
    {
      _id: "overlay-offline-welcome-strap",
      id: "offline-welcome-strap",
      type: "stick-to-bottom",
      heading: "Welcome",
      subHeading: "We're glad you're here",
      duration: 10,
      createdAt: now,
      updatedAt: now,
      docType: "overlay",
    } satisfies Omit<DBOverlay, "_rev">,
    {
      _id: "overlay-offline-speaker-card",
      id: "offline-speaker-card",
      type: "participant",
      name: "Jordan Lee",
      title: "Teaching Pastor",
      event: "Sunday gathering",
      duration: 12,
      createdAt: now,
      updatedAt: now,
      docType: "overlay",
    } satisfies Omit<DBOverlay, "_rev">,
    {
      _id: "overlay-offline-connect-qr",
      id: "offline-connect-qr",
      type: "qr-code",
      url: "https://worshipsync.com",
      description: "Scan for this week's bulletin",
      duration: 12,
      createdAt: now,
      updatedAt: now,
      docType: "overlay",
    } satisfies Omit<DBOverlay, "_rev">,
    {
      _id: "overlay-offline-title-card",
      id: "offline-title-card",
      type: "image",
      name: "Title slide",
      imageUrl:
        "https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/WorshipBackground_ycr280",
      duration: 10,
      createdAt: now,
      updatedAt: now,
      docType: "overlay",
    } satisfies Omit<DBOverlay, "_rev">,
    ...guestItemDocs.map((doc) => ({
      ...doc,
      createdAt: now,
      updatedAt: now,
    })),
  ];

  return docs;
};

export const seedOfflineGuestDatabase = async (db: PouchDB.Database) => {
  await db.bulkDocs(createOfflineGuestSeedDocs());
};
