export type Option = {
  label: string;
  value: string;
};

export type ServiceItem = {
  name: string;
  _id: string;
  background?: string;
  listId: string;
  type:
    | "song"
    | "video"
    | "image"
    | "bible"
    | "timer"
    | "announcement"
    | "free"
    | string;
};

export type MenuItemType = {
  text?: string;
  onClick?: React.MouseEventHandler;
  to?: string;
  element?: React.ReactNode;
  className?: string;
  padding?: string;
};

export type Box = {
  words?: string;
  id?: string;
  background?: string;
  width: number;
  height: number;
  label?: string;
  fontSize?: number;
  align?: "left" | "right" | "center";
  isBold?: boolean;
  isItalic?: boolean;
  brightness?: number;
  x?: number;
  y?: number;
  fontColor?: string;
  shouldKeepAspectRatio?: boolean;
  excludeFromOverflow?: boolean;
  transparent?: boolean;
  topMargin?: number;
  sideMargin?: number;
  slideIndex?: number;
};

export type SlideType =
  | "Title"
  | "Reprise"
  | "Interlude"
  | "Verse"
  | "Chorus"
  | "Refrain"
  | "Bridge"
  | "Outro"
  | "Ending"
  | "Intro"
  | "Pre-Chorus"
  | "Pre-Bridge"
  | "Blank"
  | "Section"
  | "Timer"
  | "Announcement"
  | "Image";

export type OverflowMode = "fit" | "separate";

export type ItemSlide = {
  type: SlideType;
  name: string;
  id: string;
  boxes: Box[];
  overflow?: OverflowMode;
  formattedTextDisplayInfo?: FormattedTextDisplayInfo;
};

export type LinkType = "image" | "slide" | "overlay";

export type QuickLinkType = {
  label: string;
  presentationInfo?: Presentation;
  id: string;
  action?: "clear";
  displayType?: DisplayType;
  linkType?: LinkType;
  canDelete: boolean;
};

export type DBItem = ItemProperties & {
  _rev?: string;
};

export type ItemType = "song" | "free" | "bible" | "timer" | "image" | "";
export type TimerStatus = "running" | "paused" | "stopped";
export type TimerType = "timer" | "countdown";
export type TimerInfo = {
  hostId: string;
  time?: number;
  id: string;
  name: string;
  color?: string;
  duration?: number;
  countdownTime?: string;
  timerType: TimerType;
  status: TimerStatus;
  isActive: boolean;
  remainingTime: number;
  startedAt?: string;
  endTime?: string;
  showMinutesOnly?: boolean;
};

export type ShouldSendTo = {
  projector: boolean;
  monitor: boolean;
  stream: boolean;
};

export type ItemProperties = {
  name: string;
  type: ItemType;
  _id: string;
  shouldSkipTitle?: boolean;
  selectedArrangement: number;
  background?: string;
  arrangements: Arrangment[];
  slides: ItemSlide[];
  bibleInfo?: BibleInfo;
  timerInfo?: TimerInfo;
  shouldSendTo: ShouldSendTo;
};

export type BibleFontMode = "fit" | "separate" | "multiple";

export type BibleInfo = {
  book: string;
  chapter: string;
  version: string;
  verses: verseType[];
  fontMode: BibleFontMode;
};

export type ItemState = ItemProperties & {
  listId?: string;
  selectedSlide: number;
  selectedBox: number;
  isEditMode?: boolean;
  isLoading?: boolean;
  hasPendingUpdate?: boolean;
};

export type Arrangment = {
  name: string;
  formattedLyrics: FormattedLyrics[];
  songOrder: SongOrder[];
  slides: ItemSlide[];
  id: string;
};

export type FormattedLyrics = {
  type: string;
  name: string;
  words: string;
  slideSpan: number;
  id?: string;
};

export type SongOrder = {
  id: string;
  name: string;
};

export type Presentation = {
  type: string;
  name: string;
  slide: ItemSlide | null;
  time?: number;
  displayType?: DisplayType;
  participantOverlayInfo?: OverlayInfo;
  stbOverlayInfo?: OverlayInfo;
  bibleDisplayInfo?: BibleDisplayInfo;
  timerId?: string;
  qrCodeOverlayInfo?: OverlayInfo;
  imageOverlayInfo?: OverlayInfo;
  formattedTextDisplayInfo?: FormattedTextDisplayInfo;
};

export type FormattedTextDisplayInfo = {
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
  time?: number;
  text?: string;
  paddingX?: number;
  paddingY?: number;
  align?: "left" | "right" | "center";
  isBold?: boolean;
  isItalic?: boolean;
};

export type BibleDisplayInfo = {
  title: string;
  text: string;
  time?: number;
};

export type OverlayInfo = {
  // participant
  name?: string;
  title?: string;
  event?: string;
  // stick-to-bottom
  heading?: string;
  subHeading?: string;
  // qr-code
  url?: string;
  description?: string;
  color?: string;
  // image
  imageUrl?: string;
  // shared
  duration?: number;
  type?: "participant" | "stick-to-bottom" | "qr-code" | "image";
  time?: number;
  id: string;
};

export type CreditsInfo = {
  text: string;
  heading: string;
  id: string;
  hidden?: boolean;
};

export type DisplayType =
  | "projector"
  | "monitor"
  | "stream"
  | "editor"
  | "slide";

export type verseType = {
  name: string;
  index: number;
  text?: string;
};

export type BibleChapter = {
  key: string;
  version: string;
  book: string;
  name: string;
  index: number;
  verses: verseType[];
  lastUpdated: string;
  isFromBibleGateway: boolean;
};

export type chapterType = {
  name: string;
  verses: verseType[];
  index: number;
  isFromBibleGateway?: boolean;
  lastUpdated?: string;
};

export type bookType = {
  name: string;
  chapters: chapterType[];
  index: number;
};

export type bibleType = {
  books: bookType[];
};

export type PreferencesType = {
  defaultSongBackground: string;
  defaultTimerBackground: string;
  defaultBibleBackground: string;
  defaultFreeFormBackground: string;
  defaultSongBackgroundBrightness: number;
  defaultTimerBackgroundBrightness: number;
  defaultBibleBackgroundBrightness: number;
  defaultFreeFormBackgroundBrightness: number;
  defaultSlidesPerRow: number;
  defaultSlidesPerRowMobile: number;
  defaultFormattedLyricsPerRow: number;
  defaultMediaItemsPerRow: number;
  defaultShouldShowItemEditor: boolean;
  defaultIsMediaExpanded: boolean;
  defaultBibleFontMode: BibleFontMode;
};

export type ScrollbarWidth = "thin" | "auto" | "none";

export type ItemList = {
  name: string;
  _id: string;
};

export type DBItemList = {
  name: string;
  _id: string;
  _rev: string;
};

export type ItemListDetails = {
  _id: string;
  name: string;
  items: ServiceItem[];
  overlays: OverlayInfo[];
};

export type ItemLists = {
  itemLists: ItemList[];
  selectedList: ItemList;
  _id: string;
};

export type DBItemLists = {
  itemLists: ItemList[];
  selectedList: ItemList;
  _id: string;
  _rev: string;
};

export type DBItemListDetails = {
  _id: string;
  _rev: string;
  name: string;
  items: ServiceItem[];
  overlays: OverlayInfo[];
};

export type DBPreferences = {
  _id: string;
  _rev: string;
  preferences: PreferencesType;
  quickLinks: QuickLinkType[];
};

export type DBCredits = {
  _id: string;
  _rev: string;
  list: CreditsInfo[];
};

export type DBAllItems = {
  _id: string;
  _rev: string;
  items: ServiceItem[];
};

export type Media = {
  category: string;
  name: string;
  type: string;
  id: string;
  background: string;
  thumbnail: string;
};

export type DBMedia = {
  _id: string;
  _rev: string;
  backgrounds: Media[];
};

export type DBUserInfo = {
  username: string;
  password: string;
  database: string;
  upload_preset: string;
};

export type DBLogin = {
  _id: string;
  _rev: string;
  logins: DBUserInfo[];
};

export type DBBible = {
  books: bookType[];
  lastUpdated: string;
  _id: string;
  _rev: string;
};

export type DBBibleChapter = BibleChapter & {
  _id: string;
  _rev: string;
};

export type allDocsType = {
  offset: number;
  total_rows: number;
  rows: {
    id: string;
    key: string;
    doc:
      | DBMedia
      | DBItemLists
      | DBItemListDetails
      | DBAllItems
      | DBItem
      | DBMedia;
  }[];
};

export type Instance = {
  database: string;
  hostId: string;
  isOnController: boolean;
  lastActive: string;
  user: string;
};
