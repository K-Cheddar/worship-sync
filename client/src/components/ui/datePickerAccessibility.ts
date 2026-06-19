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
