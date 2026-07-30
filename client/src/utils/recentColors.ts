export const RECENT_COLORS_STORAGE_KEY = "worshipsync:recent-colors";
export const RECENT_COLORS_MAX = 10;

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

  return `#${hex}`;
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
      if (!normalized || seen.has(normalized)) {
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
    .filter((color, index, all) => all.indexOf(color) === index)
    .slice(0, RECENT_COLORS_MAX);

  safeSet(RECENT_COLORS_STORAGE_KEY, JSON.stringify(normalized));
};

/** Prepend a color (most recent first), dedupe, keep at most {@link RECENT_COLORS_MAX}. */
export const addRecentColor = (value: string): string[] => {
  const normalized = normalizeRecentColor(value);
  if (!normalized) {
    return readRecentColors();
  }

  const next = [
    normalized,
    ...readRecentColors().filter((color) => color !== normalized),
  ].slice(0, RECENT_COLORS_MAX);

  writeRecentColors(next);
  return next;
};
