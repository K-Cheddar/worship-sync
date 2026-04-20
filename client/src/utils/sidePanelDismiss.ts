import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

/** Whether `event` originated from inside `panelRef` (uses composed path so SVG/deep targets match). */
export function sidePanelContainsEventTarget(
  panelRef: RefObject<HTMLElement | null>,
  event: ReactMouseEvent,
): boolean {
  const path = event.nativeEvent.composedPath();
  for (const n of path) {
    if (n instanceof Node && panelRef.current?.contains(n)) return true;
  }
  return false;
}

/** Radix/shadcn menus & popovers render in portals and are not under slide-out panel refs. */
export function eventTouchesPortaledOverlayChrome(event: ReactMouseEvent): boolean {
  const path = event.nativeEvent.composedPath();
  for (const n of path) {
    if (!(n instanceof Element)) continue;
    const ds = n.getAttribute?.("data-slot");
    if (
      ds === "dropdown-menu-content" ||
      ds === "dropdown-menu-item" ||
      ds === "dropdown-menu-sub-content" ||
      ds === "dropdown-menu-sub-trigger" ||
      ds === "popover-content" ||
      ds === "popover-trigger" ||
      ds === "select-content" ||
      ds === "select-item"
    ) {
      return true;
    }
  }
  return false;
}

/** Treat portaled overlays as non-dismiss when deciding to close slide-out panels on root click. */
export function sidePanelInteractionShouldRemainOpen(
  panelRef: RefObject<HTMLElement | null>,
  event: ReactMouseEvent,
): boolean {
  return (
    sidePanelContainsEventTarget(panelRef, event) ||
    eventTouchesPortaledOverlayChrome(event)
  );
}
