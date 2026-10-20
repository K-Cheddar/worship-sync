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

export const CONTROLLER_ICON_OPTIONS = [
  { id: "presentation", label: "Presentation", icon: Presentation },
  { id: "layers", label: "Layers", icon: Layers },
  { id: "monitor", label: "Monitor", icon: Monitor },
  { id: "projector", label: "Projector", icon: Projector },
  { id: "camera", label: "Camera", icon: Camera },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "book", label: "Book", icon: BookOpen },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "people", label: "People", icon: Users },
  { id: "broadcast", label: "Broadcast", icon: Radio },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: LucideIcon;
}>;

export type ControllerIconId = (typeof CONTROLLER_ICON_OPTIONS)[number]["id"];

export const CONTROLLER_COLOR_OPTIONS = [
  { id: "orange", label: "Orange", iconClass: "text-orange-300", swatchClass: "bg-orange-300" },
  { id: "purple", label: "Purple", iconClass: "text-purple-300", swatchClass: "bg-purple-300" },
  { id: "cyan", label: "Cyan", iconClass: "text-cyan-300", swatchClass: "bg-cyan-300" },
  { id: "blue", label: "Blue", iconClass: "text-blue-300", swatchClass: "bg-blue-300" },
  { id: "teal", label: "Teal", iconClass: "text-teal-300", swatchClass: "bg-teal-300" },
  { id: "indigo", label: "Indigo", iconClass: "text-indigo-300", swatchClass: "bg-indigo-300" },
  { id: "violet", label: "Violet", iconClass: "text-violet-300", swatchClass: "bg-violet-300" },
  { id: "amber", label: "Amber", iconClass: "text-amber-300", swatchClass: "bg-amber-300" },
  { id: "pink", label: "Pink", iconClass: "text-pink-300", swatchClass: "bg-pink-300" },
  { id: "green", label: "Green", iconClass: "text-green-300", swatchClass: "bg-green-300" },
] as const;

export type ControllerIconColor = (typeof CONTROLLER_COLOR_OPTIONS)[number]["id"];

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
