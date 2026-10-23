export type BuiltInIconSource = "lucide" | "tabler" | "worshipsync";

/** Render-only fallback for entity icons without a user color override. */
export const ENTITY_ICON_DEFAULT_COLOR = "#475569";
/** @deprecated Use ENTITY_ICON_DEFAULT_COLOR. */
export const POSITION_ICON_DEFAULT_COLOR = ENTITY_ICON_DEFAULT_COLOR;

export type IconRef =
  | { source: BuiltInIconSource; name: string; color?: string }
  | { source: "custom"; id: string; color?: string };

/** Older team and position records store a Lucide export name directly. */
export type EntityIcon = string | IconRef;
/** @deprecated Use EntityIcon. */
export type PositionIcon = EntityIcon;

export type IconCatalogEntry = {
  ref: IconRef;
  label: string;
  searchTerms: string[];
};

/** Validate persisted icon data without importing the searchable icon catalog. */
export const normalizeEntityIcon = (value?: unknown): IconRef | null => {
  if (typeof value === "string") {
    return value ? { source: "lucide", name: value } : null;
  }
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const color = entry.color;
  if (color !== undefined && (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))) return null;
  const colorField = color ? { color } : {};
  if (entry.source === "custom") {
    return typeof entry.id === "string" && entry.id.trim()
      ? { source: "custom", id: entry.id.trim(), ...colorField }
      : null;
  }
  if (
    (entry.source === "lucide" || entry.source === "tabler" || entry.source === "worshipsync") &&
    typeof entry.name === "string" && entry.name.trim()
  ) {
    return { source: entry.source, name: entry.name.trim(), ...colorField };
  }
  return null;
};
