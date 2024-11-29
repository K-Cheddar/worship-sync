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
};

export type Box = {
  words?: string;
  id?: string;
  isLocked?: boolean;
  background?: string;
  width: number;
  height: number;
  label?: string;
  fontSize?: number;
  align?: "left" | "right" | "center";
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

export type ItemSlide = {
  type: string;
  id?: string;
  boxes: Box[];
};

export type QuickLinkType = {
  title: string;
  url?: string;
  id: string;
  action?: "clear";
  displayType?: DisplayType;
};

export type DBItem = {
  _id: string;
  name: string;
  selectedArrangement: number;
  skipTitle?: boolean;
  background?: string;
  type: string;
  slides: ItemSlide[];
  bibleInfo?: {
    book: string;
    chapter: string;
    version: string;
    verses: verseType[];
  };
  arrangements: {
    name: string;
    formattedLyrics: FormattedLyrics[];
    songOrder: string[] | SongOrder[];
    slides: ItemSlide[];
  }[];
};

export type ItemState = {
  name: string;
  type: string;
  _id: string;
  listId?: string;
  selectedArrangement: number;
  shouldSkipTitle?: boolean;
  _rev?: string;
  background?: string;
  arrangements: Arrangment[];
  selectedSlide: number;
  selectedBox: number;
  slides: ItemSlide[];
  isEditMode?: boolean;
  bibleInfo?: {
    book: string;
    chapter: string;
    version: string;
    verses: verseType[];
  };
  isLoading?: boolean;
  hasPendingUpdate?: boolean;
};

export type OptionalItemState = {
  name: string;
  type: string;
  _id?: string;
  listId?: string;
  selectedArrangement?: number;
  shouldSkipTitle?: boolean;
  arrangements?: Arrangment[];
  selectedSlide?: number;
  selectedBox?: number;
  slides?: ItemSlide[];
  isEditMode?: boolean;
  bibleInfo?: {
    book: string;
    chapter: string;
    verse: string;
    version: string;
  };
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
};

export type BibleDisplayInfo = {
  title: string;
  text: string;
  time?: number;
};

export type OverlayInfo = {
  name?: string;
  title?: string;
  event?: string;
  duration?: number;
  type?: "participant" | "stick-to-bottom" | "qr-code";
  time?: number;
  id: string;
  showDelete?: boolean;
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

export type chapterType = {
  name: string;
  verses: verseType[];
  index: number;
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
  slidesPerRow: number;
  formattedLyricsPerRow: number;
};

export type ItemList = {
  name: string;
  id: string;
  isOutline?: boolean;
};

export type ItemListDetails = {
  name: string;
  _id: string;
  isOutline?: boolean;
  items: ServiceItem[];
  overlays: OverlayInfo[];
};

export type DBItemList = {
  id: string;
  name: string;
  outline?: boolean;
};

export type DBItemLists = {
  itemLists: DBItemList[];
  selectedList: DBItemList;
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
  image: string;
  video?: string;
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
