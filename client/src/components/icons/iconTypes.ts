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
