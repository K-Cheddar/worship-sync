import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const HIDE_PROJECTOR_CURSOR_STYLE_ID =
  "worshipsync-hide-projector-cursor";

const isProjectorPathname = (pathname: string) =>
  pathname === "/projector" || pathname === "/projector-full";

/** Remove a leaked hide-cursor style (e.g. after navigating away from projector). */
export const clearHideProjectorCursorStyle = () => {
  if (typeof document === "undefined") return;
  document.getElementById(HIDE_PROJECTOR_CURSOR_STYLE_ID)?.remove();
};

/**
 * Hide the mouse pointer on an activated (signed-in) projector surface.
 *
 * Electron used to inject this at window create time, which also hid the cursor
 * on the display pairing / sign-in screens in that same window. Applying it
 * only while the authenticated projector route is mounted keeps the pointer
 * available for linking the screen, then hides it once output is live.
 *
 * Scope is route-gated on purpose: this must never stick on `/monitor` (or any
 * other surface) if the hook is mounted from a shared path or a style tag
 * leaks across an in-window navigation.
 */
export const useHideProjectorCursor = (enabled = true) => {
  const { pathname } = useLocation();
  const shouldHide = enabled && isProjectorPathname(pathname);

  useEffect(() => {
    if (!shouldHide) {
      clearHideProjectorCursorStyle();
      return;
    }

    let style = document.getElementById(
      HIDE_PROJECTOR_CURSOR_STYLE_ID,
    ) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = HIDE_PROJECTOR_CURSOR_STYLE_ID;
      style.textContent = "*, *::before, *::after { cursor: none !important; }";
      document.head.appendChild(style);
    }

    return () => {
      clearHideProjectorCursorStyle();
    };
  }, [shouldHide]);
};
