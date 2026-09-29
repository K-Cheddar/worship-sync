export type BuiltInIconSource = "lucide" | "tabler" | "worshipsync";

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
