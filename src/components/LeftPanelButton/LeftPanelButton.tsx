import Button, { ButtonProps } from "../Button/Button"
import React, { FunctionComponent, ReactElement } from "react";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import { ReactComponent as SongSVG } from "../../assets/icons/lyrics.svg";
import { ReactComponent as VideoSVG } from "../../assets/icons/video.svg";
import { ReactComponent as BibleSVG } from "../../assets/icons/book.svg";
import { ReactComponent as TimerSVG } from "../../assets/icons/timer.svg";
import { ReactComponent as ImageSVG } from "../../assets/icons/image.svg";
import { ReactComponent as AnnouncementSVG } from "../../assets/icons/news.svg";
import { ReactComponent as AllItemsSVG } from "../../assets/icons/view-list.svg";
import { ReactComponent as OverlaysSVG } from "../../assets/icons/overlays.svg";
import cn from "classnames";

const svgMap : Map<string, FunctionComponent> = new Map([
  ["song", SongSVG],
  ["video", VideoSVG],
  ["image", ImageSVG],
  ["bible", BibleSVG],
  ["timer", TimerSVG],
  ["announcement", AnnouncementSVG],
  ["all", AllItemsSVG],
  ["overlay", OverlaysSVG],
])

const borderColorMap : Map<string, string> = new Map([
  ["song", "border-blue-500"],
  ["video", "border-purple-500"],
  ["image", "border-orange-500"],
  ["bible", "border-green-500"],
  ["timer", "border-pink-500"],
  ["announcement", "border-yellow-500"],
  ["all", "border-lime-200"],
  ["overlay", "border-red-500"],
])

const iconColorMap : Map<string, string> = new Map([
  ["song", "#3b82f6"],
  ["video", "#a855f7"],
  ["image", "#f97316"],
  ["bible", "#22c55e"],
  ["timer", "#ec4899"],
  ["announcement", "#eab308"],
  ["all", "#d9f99d"],
  ["overlay", "#ef4444"],
])

type LeftPanelButtonProps = {
  selectedItem: string,
  id: string,
  handleClick: (itemId: string) => void,
  title: string,
  type: string,
  actions?: ReactElement<ButtonProps>[],
}

const LeftPanelButton = ({ selectedItem, id, handleClick, title, type, actions } : LeftPanelButtonProps) => {
  const isSelected = selectedItem === id;
  
  return (
    <span className={cn("flex", isSelected && 'bg-gray-900')}>
      <Button 
        variant="tertiary" 
        className={`w-full border-l-4 ${borderColorMap.get(type)}`}
        onClick={() => handleClick(id)} 
        wrap
        svg={svgMap.get(type) || UnknownSVG}
        gap="gap-3"
        color={iconColorMap.get(type)}
        isSelected={isSelected}
      >
        <p className="font-semibold">{title}</p>
      </Button>
      {actions && actions.map((action) => action)}
    </span>
  )
}

export default LeftPanelButton;
