import type { KeyboardEvent } from "react";

/** Icon color for inline edit “confirm” (check) actions — Tailwind `cyan-500`. */
export const INLINE_EDIT_CONFIRM_ICON_COLOR = "#06b6d4";

type InlineTextKeyHandlers = {
  onSave: () => void | Promise<void>;
  onCancel: () => void;
};

/**
 * For single-line inputs: Enter saves, Escape cancels (same as the dismiss control).
 * Call from `Input` `onKeyDown`.
 */
export function handleInlineTextInputKeyDown(
  e: KeyboardEvent<HTMLInputElement>,
  { onSave, onCancel }: InlineTextKeyHandlers,
): void {
  if (e.key === "Enter") {
    e.preventDefault();
    void onSave();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    onCancel();
  }
}
