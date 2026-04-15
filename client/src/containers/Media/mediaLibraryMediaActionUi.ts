import cn from "classnames";

/**
 * Shared Lucide sizing for media library route actions (inline bar, overflow, dropdowns).
 * Keep in sync with measure-row clones in `MediaLibraryActionBar`.
 */
export const MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE =
  "size-3.5 max-md:size-5 shrink-0";

/** Matches `FilteredItems` “Create a new …” `Button` `color="#84cc16"`. */
export const MEDIA_LIBRARY_MEDIA_ACTION_CREATE_ICON_CLASS = cn(
  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
  "text-[#84cc16]",
);

export const MEDIA_LIBRARY_MEDIA_ACTION_RENAME_ICON_CLASS = cn(
  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
  "text-yellow-400",
);

/** Layout + tap target; icon color applied per control (cyan default, exceptions below). */
export const MEDIA_LIBRARY_ACTION_BAR_BTN_BASE_CLASS =
  "min-h-8 h-8 max-md:h-auto max-md:min-h-12 max-md:py-2.5 gap-1 px-1.5 max-md:px-2 text-xs [&_svg:not([class*='size-'])]:!size-3.5";

export const MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS = cn(
  MEDIA_LIBRARY_ACTION_BAR_BTN_BASE_CLASS,
  "[&_svg]:text-cyan-400",
);

/** Move-to-folder list rows: orange folder icons; no default cyan on SVG. */
export const MEDIA_LIBRARY_ACTION_MENU_MOVE_ITEM_CLASS =
  "min-h-8 max-md:min-h-12 max-md:py-2.5 text-xs max-md:text-sm text-white focus:text-white max-md:[&_svg]:!size-5";

export const MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS = cn(
  MEDIA_LIBRARY_ACTION_MENU_MOVE_ITEM_CLASS,
  "[&_svg]:text-cyan-400",
);

type MediaBarActionKey = {
  id: string;
  variant?: "default" | "destructive";
};

/** Inline / dropdown trigger buttons for `buildMediaLibraryBarActions` entries. */
export function classNameForMediaLibraryBarAction(
  action: MediaBarActionKey,
): string {
  const shrink = "shrink-0";
  if (action.variant === "destructive") {
    return cn(
      MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
      shrink,
      "text-white [&_svg]:text-red-500!",
    );
  }
  if (action.id === "send-media-to-projector") {
    return cn(MEDIA_LIBRARY_ACTION_BAR_BTN_BASE_CLASS, shrink);
  }
  if (action.id === "create-custom-item-from-media") {
    return cn(MEDIA_LIBRARY_ACTION_BAR_BTN_BASE_CLASS, shrink);
  }
  return cn(MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS, shrink);
}

/** Overflow `DropdownMenuItem` rows for the same actions (icon colors mostly on Lucide). */
export function classNameForMediaLibraryOverflowMenuItem(
  action: MediaBarActionKey,
): string {
  if (action.variant === "destructive") {
    return cn(MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS, "[&_svg]:text-red-500!");
  }
  if (
    action.id === "send-media-to-projector" ||
    action.id === "create-custom-item-from-media"
  ) {
    return MEDIA_LIBRARY_ACTION_MENU_MOVE_ITEM_CLASS;
  }
  return MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS;
}
