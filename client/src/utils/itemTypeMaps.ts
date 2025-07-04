import { ReactComponent as SongSVG } from "../assets/icons/lyrics.svg";
import { ReactComponent as AddSVG } from "../assets/icons/add.svg";
import { ReactComponent as VideoSVG } from "../assets/icons/video.svg";
import { ReactComponent as BibleSVG } from "../assets/icons/book.svg";
import { ReactComponent as TimerSVG } from "../assets/icons/timer.svg";
import { ReactComponent as ImageSVG } from "../assets/icons/image.svg";
import { ReactComponent as AnnouncementSVG } from "../assets/icons/news.svg";
import { ReactComponent as DocSVG } from "../assets/icons/doc.svg";
import { ReactComponent as PeopleSVG } from "../assets/icons/people.svg";
import { FunctionComponent } from "react";

export const svgMap: Map<string, FunctionComponent> = new Map([
  ["song", SongSVG],
  ["video", VideoSVG],
  ["image", ImageSVG],
  ["bible", BibleSVG],
  ["timer", TimerSVG],
  ["announcement", AnnouncementSVG],
  ["overlays", PeopleSVG],
  ["create", AddSVG],
  ["free", DocSVG],
]);

export const borderColorMap: Map<string, string> = new Map([
  ["song", "border-blue-500"],
  ["video", "border-purple-500"],
  ["image", "border-violet-500"],
  ["bible", "border-yellow-500"],
  ["timer", "border-pink-500"],
  ["announcement", "border-yellow-500"],
  ["create", "border-lime-400"],
  ["overlays", "border-red-500"],
  ["free", "border-orange-500"],
]);

export const iconColorMap: Map<string, string> = new Map([
  ["song", "#3b82f6"],
  ["video", "#a855f7"],
  ["image", "#f97316"],
  ["bible", "#eab308"],
  ["timer", "#ec4899"],
  ["announcement", "#eab308"],
  ["create", "#a3e635"],
  ["overlays", "#ef4444"],
  ["free", "#f97316"],
]);
