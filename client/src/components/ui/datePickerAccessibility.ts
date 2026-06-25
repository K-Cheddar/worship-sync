import type { KeyboardEvent } from "react";

/** Opens the date picker popover when the user presses Alt+ArrowDown in the field. */
export const openCalendarOnAltArrowDown = (
  event: KeyboardEvent,
  onOpen: () => void,
  disabled = false,
): boolean => {
  if (disabled || !event.altKey || event.key !== "ArrowDown") {
    return false;
  }
  event.preventDefault();
  onOpen();
  return true;
};

export const DATE_PICKER_POPOVER_KEYSHORTCUT = "Alt+ArrowDown";

/** Shared popover shell for date, range, and date-time pickers. */
export const DATE_PICKER_POPOVER_CONTENT_CLASS =
  "w-auto max-lg:min-w-[min(100vw-2rem,22.5rem)] rounded-md border border-gray-700 bg-gray-900 p-0 shadow-xl";
