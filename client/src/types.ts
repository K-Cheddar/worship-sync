export type Option = {
  label: string;
  value: string;
};

export type ServiceItem = {
  name: string;
  _id: string;
  listId: string;
  background?: string;
  nameColor?: string;
  type:
    | "song"
    | "video"
    | "image"
    | "bible"
    | "timer"
    | "announcement"
    | string;
};

export type DBServiceItem = Omit<ServiceItem, "listId">;

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

export type ItemState = {
  name: string;
  type: string;
  id: string;
  selectedArrangement: number;
  shouldSkipTitle?: boolean;
  listId?: string;
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
};

export type OptionalItemState = {
  name: string;
  type: string;
  id?: string;
  selectedArrangement?: number;
  shouldSkipTitle?: boolean;
  listId?: string;
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

export type DBItem = {
  _id: string;
  name: string;
  background: string;
  selectedArrangement: number;
  skipTitle: boolean;
  type: string;
  _rev: string;
  arrangements: {
    name: string;
    formattedLyrics: FormattedLyrics[];
    songOrder: string[];
    slides: ItemSlide[];
  }[];
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
  participantInfo?: ParticipantInfo;
  bibleDisplayInfo?: BibleDisplayInfo;
};

export type BibleDisplayInfo = {
  title: string;
  text: string;
};

export type ParticipantInfo = {
  name?: string;
  title?: string;
  event?: string;
};

export type DisplayType =
  | "projector"
  | "monitor"
  | "stream"
  | "editor"
  | "slide";

export type ParticipantType = {
  name: string;
  title: string;
  event: string;
  id: string;
  showDelete: boolean;
};

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
