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
  slideIndex?: number
}

export type ItemSlide = {
  type: string,
  id?: string,
  name?: string,
  boxes: Box[],
}

export type QuickLinkType = {
  title: string
  url?: string
  id: string
}