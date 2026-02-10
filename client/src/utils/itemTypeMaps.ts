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

/** Overlay type -> left border accent (e.g. border-l-blue-500). */
export const overlayBorderColorMap: Map<string, string> = new Map([
  ["participant", "border-l-blue-500"],
  ["stick-to-bottom", "border-l-amber-500"],
  ["qr-code", "border-l-emerald-500"],
  ["image", "border-l-violet-500"],
]);

/** Overlay type -> text color (e.g. text-blue-500). */
export const overlayTextColorMap: Map<string, string> = new Map([
  ["participant", "text-blue-500"],
  ["stick-to-bottom", "text-amber-500"],
  ["qr-code", "text-emerald-500"],
  ["image", "text-violet-500"],
]);

/** Overlay type -> display label. */
export const overlayTypeLabelMap: Map<string, string> = new Map([
  ["participant", "Participant"],
  ["stick-to-bottom", "Stick to bottom"],
  ["qr-code", "QR code"],
  ["image", "Image"],
]);
