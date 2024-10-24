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
  text?: string,
  id: string,
  isLocked: boolean,
  image?: string,
  width: number,
  height: number,
  label?: string,
  fontSize?: number,
  align: 'left' | 'right' | 'center',
  marginTop: number,
  marginBottom: number
  marginLeft: number,
  marginRight: number
}

export type ItemSlide = {
  type: string,
  id: string,
  name: string,
  boxes: Box[],
}

export type QuickLinkType = {
  title: string
  url?: string
  id: string
}