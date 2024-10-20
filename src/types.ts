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