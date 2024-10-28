export type Option = {
  label: string
  value: string
}

export type ServiceItem = {
  title: string;
  type: 'song' | 'video' | 'image' | 'bible' | 'timer' | 'announcement' | string ;
  id: string;
}

export type MenuItemType = {
  text?: string,
  onClick?: React.MouseEventHandler,
  to?: string
}

export type Box = {
  words?: string,
  id?: string,
  isLocked?: boolean,
  background?: string,
  width: number,
  height: number,
  label?: string,
  fontSize?: number,
  align?: 'left' | 'right' | 'center',
  brightness?: number,
  x?: number,
  y?: number
  fontColor?: string,
  excludeFromOverflow?: boolean,
  transparent?: boolean,
  topMargin?: number,
  sideMargin?: number,
  slideIndex?: number,
}

export type ItemSlide = {
  type: string,
  id?: string,
  boxes: Box[],
}

export type QuickLinkType = {
  title: string
  url?: string
  id: string
}

export type UpdateItemState = {
  name: string,
  type: string,
  id: string,
  selectedArrangement: number,
  shouldSkipTitle: boolean,
  arrangements: Arrangment[],
}

export type DBItem = Omit<UpdateItemState, 'songOrder' | 'arrangements'> & {
  arrangements: {
    name: string,
    formattedLyrics: FormattedLyrics[],
    songOrder: string[],
    slides: ItemSlide[]
  }[]
}

export type Arrangment = {
  name: string,
  formattedLyrics: FormattedLyrics[],
  songOrder: SongOrder[],
  slides: ItemSlide[]
}

export type FormattedLyrics = {
  type: string,
  name: string,
  words: string,
  slideSpan: number,
  id?: string
}

export type SongOrder = {
  id: string,
  name: string
}

export type Presentation = {
  type: string,
  name: string,
  slide: ItemSlide | null,
  time?: number,
  displayType?: DisplayType,
  overlayInfo?: OverlayInfo
}

export type OverlayInfo = {
  name?: string,
  title?: string,
  event?: string
}

export type DisplayType = 'projector' | 'monitor' | 'stream' | 'editor' | 'slide'

export type MiddleSection = 'bible-panel' | 'songs-panel' | 'participants-panel' | 'service-item'

export type ParticipantType = {
  name: string,
  title: string,
  event: string,
  id: string,
  showDelete: boolean
}