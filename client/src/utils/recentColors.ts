export const RECENT_COLORS_STORAGE_KEY = "worshipsync:recent-colors";

/** Shared second-row palette; recent capacity matches this length so both rows align. */
export const COMMON_COLOR_SWATCHES = [
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#78716C",
  "#FFFFFF",
  "#000000",
] as const;

export const RECENT_COLORS_MAX = COMMON_COLOR_SWATCHES.length;

const COMMON_COLOR_SWATCH_SET = new Set<string>(COMMON_COLOR_SWATCHES);

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const safeGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort: ignore quota / disabled-storage errors.
  }
};

/** Normalize to uppercase `#RRGGBB` / `#RRGGBBAA` when valid; otherwise null. */
export const normalizeRecentColor = (value: string): string | null => {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return null;
  }

  let hex = trimmed.slice(1).toUpperCase();
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }

  // Opaque alpha is equivalent to a 6-digit color for recent/common matching.
  if (hex.length === 8 && hex.endsWith("FF")) {
    hex = hex.slice(0, 6);
  }

  return `#${hex}`;
};

export const isCommonColorSwatch = (value: string): boolean => {
  const normalized = normalizeRecentColor(value);
  return normalized != null && COMMON_COLOR_SWATCH_SET.has(normalized);
};

export const readRecentColors = (): string[] => {
  const raw = safeGet(RECENT_COLORS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seen = new Set<string>();
    const colors: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") {
        continue;
      }
      const normalized = normalizeRecentColor(entry);
      // Skip common palette colors so they do not consume recent row slots.
      if (
        !normalized ||
        seen.has(normalized) ||
        COMMON_COLOR_SWATCH_SET.has(normalized)
      ) {
        continue;
      }
      seen.add(normalized);
      colors.push(normalized);
      if (colors.length >= RECENT_COLORS_MAX) {
        break;
      }
    }
    return colors;
  } catch {
    return [];
  }
};

export const writeRecentColors = (colors: string[]): void => {
  const normalized = colors
    .map(normalizeRecentColor)
    .filter((color): color is string => Boolean(color))
    .filter((color) => !COMMON_COLOR_SWATCH_SET.has(color))
    .filter((color, index, all) => all.indexOf(color) === index)
    .slice(0, RECENT_COLORS_MAX);

  safeSet(RECENT_COLORS_STORAGE_KEY, JSON.stringify(normalized));
};

/** Prepend a color (most recent first), dedupe, keep at most {@link RECENT_COLORS_MAX}. */
export const addRecentColor = (value: string): string[] => {
  const normalized = normalizeRecentColor(value);
  if (!normalized || COMMON_COLOR_SWATCH_SET.has(normalized)) {
    return readRecentColors();
  }

  const next = [
    normalized,
    ...readRecentColors().filter((color) => color !== normalized),
  ].slice(0, RECENT_COLORS_MAX);

  writeRecentColors(next);
  return next;
};
