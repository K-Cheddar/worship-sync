import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CalendarDays,
  Camera,
  Captions,
  Layers,
  Monitor,
  Presentation,
  Projector,
  Radio,
  Users,
} from "lucide-react";
import type { ControllerProfileType } from "./controllerProfiles";
import { normalizeEntityIcon } from "../components/icons/iconTypes";
import type { IconRef } from "../components/icons/iconTypes";

export const CONTROLLER_ICON_OPTIONS = [
  { id: "presentation", label: "Presentation", icon: Presentation, iconName: "Presentation" },
  { id: "layers", label: "Layers", icon: Layers, iconName: "Layers" },
  { id: "monitor", label: "Monitor", icon: Monitor, iconName: "Monitor" },
  { id: "projector", label: "Projector", icon: Projector, iconName: "Projector" },
  { id: "camera", label: "Camera", icon: Camera, iconName: "Camera" },
  { id: "captions", label: "Captions", icon: Captions, iconName: "Captions" },
  { id: "book", label: "Book", icon: BookOpen, iconName: "BookOpen" },
  { id: "calendar", label: "Calendar", icon: CalendarDays, iconName: "CalendarDays" },
  { id: "people", label: "People", icon: Users, iconName: "Users" },
  { id: "broadcast", label: "Broadcast", icon: Radio, iconName: "Radio" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: LucideIcon;
  iconName: string;
}>;

export type ControllerIconId = (typeof CONTROLLER_ICON_OPTIONS)[number]["id"];

export const CONTROLLER_COLOR_OPTIONS = [
  { id: "orange", label: "Orange", iconClass: "text-orange-300", swatchClass: "bg-orange-300", hex: "#fdba74" },
  { id: "purple", label: "Purple", iconClass: "text-purple-300", swatchClass: "bg-purple-300", hex: "#d8b4fe" },
  { id: "cyan", label: "Cyan", iconClass: "text-cyan-300", swatchClass: "bg-cyan-300", hex: "#67e8f9" },
  { id: "blue", label: "Blue", iconClass: "text-blue-300", swatchClass: "bg-blue-300", hex: "#93c5fd" },
  { id: "teal", label: "Teal", iconClass: "text-teal-300", swatchClass: "bg-teal-300", hex: "#5eead4" },
  { id: "indigo", label: "Indigo", iconClass: "text-indigo-300", swatchClass: "bg-indigo-300", hex: "#a5b4fc" },
  { id: "violet", label: "Violet", iconClass: "text-violet-300", swatchClass: "bg-violet-300", hex: "#c4b5fd" },
  { id: "amber", label: "Amber", iconClass: "text-amber-300", swatchClass: "bg-amber-300", hex: "#fcd34d" },
  { id: "pink", label: "Pink", iconClass: "text-pink-300", swatchClass: "bg-pink-300", hex: "#f9a8d4" },
  { id: "green", label: "Green", iconClass: "text-green-300", swatchClass: "bg-green-300", hex: "#86efac" },
] as const;

export type ControllerIconColor = (typeof CONTROLLER_COLOR_OPTIONS)[number]["id"];

export const CONTROLLER_RECOMMENDED_ICON_GROUPS: Array<{ label: string; icons: IconRef[] }> = [
  { label: "Presentation & graphics", icons: [
    { source: "lucide", name: "Presentation" },
    { source: "lucide", name: "MonitorPlay" },
    { source: "lucide", name: "Layers3" },
    { source: "lucide", name: "Captions" },
    { source: "lucide", name: "Clapperboard" },
    { source: "lucide", name: "Image" },
  ] },
  { label: "Monitors & displays", icons: [
    { source: "lucide", name: "Monitor" },
    { source: "lucide", name: "MonitorCog" },
    { source: "lucide", name: "Projector" },
    { source: "lucide", name: "Tv" },
    { source: "lucide", name: "PanelsTopLeft" },
    { source: "lucide", name: "ScreenShare" },
  ] },
  { label: "Cameras & video", icons: [
    { source: "lucide", name: "Camera" },
    { source: "lucide", name: "Webcam" },
    { source: "lucide", name: "Video" },
    { source: "lucide", name: "Focus" },
    { source: "lucide", name: "ScanLine" },
  ] },
  { label: "Streaming & broadcast", icons: [
    { source: "lucide", name: "Radio" },
    { source: "lucide", name: "RadioTower" },
    { source: "lucide", name: "Cast" },
    { source: "lucide", name: "Podcast" },
    { source: "lucide", name: "Antenna" },
  ] },
  { label: "Production & technical", icons: [
    { source: "lucide", name: "Mic" },
    { source: "lucide", name: "AudioLines" },
    { source: "lucide", name: "Cable" },
    { source: "lucide", name: "Network" },
    { source: "lucide", name: "Settings2" },
  ] },
];

const DEFAULT_ICON_BY_TYPE: Record<ControllerProfileType, ControllerIconId> = {
  presentation: "presentation",
  overlay: "layers",
  "aux-presentation": "monitor",
};

const AUXILIARY_COLORS: ControllerIconColor[] = [
  "cyan",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
  "green",
  "amber",
];

export const getDefaultControllerIcon = (
  type: ControllerProfileType,
): ControllerIconId => DEFAULT_ICON_BY_TYPE[type];

export const getDefaultControllerIconColor = (
  type: ControllerProfileType,
  order = 0,
): ControllerIconColor => {
  if (type === "presentation") return "orange";
  if (type === "overlay") return "purple";
  const normalizedOrder = Number.isFinite(order)
    ? Math.max(0, Math.floor(order) - 2)
    : 0;
  return AUXILIARY_COLORS[normalizedOrder % AUXILIARY_COLORS.length] ?? "cyan";
};

export const normalizeControllerIcon = (
  value: unknown,
  type: ControllerProfileType,
): ControllerIconId => {
  if (
    typeof value === "string" &&
    CONTROLLER_ICON_OPTIONS.some((option) => option.id === value)
  ) {
    return value as ControllerIconId;
  }
  return getDefaultControllerIcon(type);
};

export const normalizeControllerIconColor = (
  value: unknown,
  type: ControllerProfileType,
  order = 0,
): ControllerIconColor => {
  if (
    typeof value === "string" &&
    CONTROLLER_COLOR_OPTIONS.some((option) => option.id === value)
  ) {
    return value as ControllerIconColor;
  }
  return getDefaultControllerIconColor(type, order);
};

export const getControllerIconComponent = (value: unknown): LucideIcon => {
  const id = normalizeControllerIcon(value, "aux-presentation");
  return CONTROLLER_ICON_OPTIONS.find((option) => option.id === id)?.icon ?? Monitor;
};

export const getControllerIconColorClass = (value: unknown): string => {
  const id = normalizeControllerIconColor(value, "aux-presentation");
  return CONTROLLER_COLOR_OPTIONS.find((option) => option.id === id)?.iconClass ?? "text-cyan-300";
};

/** Convert an existing named appearance into a rich picker value without changing its saved fields. */
export const getLegacyControllerHomeIcon = (
  iconValue: unknown,
  colorValue: unknown,
  type: ControllerProfileType,
  order = 0,
): IconRef => {
  const iconId = normalizeControllerIcon(iconValue, type);
  const colorId = normalizeControllerIconColor(colorValue, type, order);
  const iconName = CONTROLLER_ICON_OPTIONS.find((option) => option.id === iconId)?.iconName ?? "Monitor";
  const color = CONTROLLER_COLOR_OPTIONS.find((option) => option.id === colorId)?.hex;
  return { source: "lucide", name: iconName, ...(color ? { color } : {}) };
};

/** Normalize shared icon refs; unsupported render names fall back in the shared renderer. */
export const getRenderableControllerHomeIcon = (value: unknown): IconRef | undefined => {
  const normalized = normalizeEntityIcon(value);
  if (!normalized || normalized.source === "custom") return undefined;
  return normalized;
};
