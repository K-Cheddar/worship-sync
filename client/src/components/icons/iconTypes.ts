export type BuiltInIconSource = "lucide" | "tabler" | "worshipsync";

/** Render-only fallback for position icons without a user color override. */
export const POSITION_ICON_DEFAULT_COLOR = "#475569";

export type IconRef =
  | { source: BuiltInIconSource; name: string; color?: string }
  | { source: "custom"; id: string; color?: string };

/** Older position records store a Lucide export name directly. */
export type PositionIcon = string | IconRef;

export type IconCatalogEntry = {
  ref: IconRef;
  label: string;
  searchTerms: string[];
};
