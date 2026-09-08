import { useEffect } from "react";

const STYLE_ID = "worshipsync-hide-projector-cursor";

/**
 * Hide the mouse pointer on an activated (signed-in) projector surface.
 *
 * Electron used to inject this at window create time, which also hid the cursor
 * on the display pairing / sign-in screens in that same window. Applying it
 * only while the authenticated projector route is mounted keeps the pointer
 * available for linking the screen, then hides it once output is live.
 */
export const useHideProjectorCursor = (enabled = true) => {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent =
        "*, *::before, *::after { cursor: none !important; }";
      document.head.appendChild(style);
    }

    return () => {
      document.getElementById(STYLE_ID)?.remove();
    };
  }, [enabled]);
};
