import { LucideIcon, Music } from "lucide-react";
import { Plus } from "lucide-react";
import { Video } from "lucide-react";
import { Book } from "lucide-react";
import { Timer } from "lucide-react";
import { Image } from "lucide-react";
import { Megaphone } from "lucide-react";
import { Users } from "lucide-react";
import { File } from "lucide-react";
export const svgMap: Map<string, LucideIcon> = new Map<string, LucideIcon>([
  ["song", Music],
  ["video", Video],
  ["image", Image],
  ["bible", Book],
  ["timer", Timer],
  ["announcement", Megaphone],
  ["overlays", Users],
  ["create", Plus],
  ["free", File],
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
