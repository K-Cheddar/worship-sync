import type { FunctionComponent, SVGProps } from "react";
import * as LucideIcons from "lucide-react";

type LucideIcon = FunctionComponent<SVGProps<SVGSVGElement>>;

/**
 * Curated, church/AV/production-relevant icons shown first in the position icon
 * picker. Names are lucide PascalCase exports and are validated at runtime by
 * `resolvePositionLucideIcon` so a rename in lucide degrades gracefully.
 */
export const CURATED_ROLE_ICONS: string[] = [
  "Mic",
  "Mic2",
  "MicVocal",
  "Music",
  "Music2",
  "Music4",
  "Guitar",
  "Piano",
  "Drum",
  "Speaker",
  "Headphones",
  "Volume2",
  "AudioLines",
  "AudioWaveform",
  "Radio",
  "SlidersHorizontal",
  "Video",
  "Camera",
  "Clapperboard",
  "Projector",
  "MonitorPlay",
  "Tv",
  "Lightbulb",
  "Sparkles",
  "Presentation",
  "Captions",
  "Users",
  "User",
  "UserCog",
  "Hand",
  "Church",
  "BookOpen",
  "Cross",
  "Heart",
  "Star",
  "Wrench",
];

const EXCLUDED_EXPORTS = new Set([
  "createLucideIcon",
  "Icon",
  "icons",
  "LucideProps",
  "default",
]);

const isLikelyIconComponent = (value: unknown): value is LucideIcon =>
  typeof value === "object" || typeof value === "function";

/** All lucide icons as `[name, Component]`, computed once. */
let cachedIconList: Array<[string, LucideIcon]> | null = null;

export const getAllLucideIcons = (): Array<[string, LucideIcon]> => {
  if (cachedIconList) return cachedIconList;
  cachedIconList = Object.entries(LucideIcons)
    .filter(
      ([name, value]) =>
        /^[A-Z]/.test(name) &&
        !name.startsWith("Lucide") &&
        !EXCLUDED_EXPORTS.has(name) &&
        isLikelyIconComponent(value),
    )
    .map(([name, value]) => [name, value as LucideIcon]);
  return cachedIconList;
};

/** Resolve a stored icon name to its lucide component, or null if unknown. */
export const resolvePositionLucideIcon = (name?: string | null): LucideIcon | null => {
  if (!name) return null;
  const icon = (LucideIcons as Record<string, unknown>)[name];
  return isLikelyIconComponent(icon) ? (icon as LucideIcon) : null;
};
