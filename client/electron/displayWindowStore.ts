/**
 * Generic display window storage (step 3.1 of Display System Genericization Plan).
 * Uses a Map keyed by display type so new window types can be added without new variables.
 */
const displayWindows = new Map<string, unknown>();

export function getDisplayWindow(displayType: string): unknown {
  return displayWindows.get(displayType) ?? null;
}

export function setDisplayWindow(
  displayType: string,
  window: unknown | null,
): void {
  if (window != null) {
    displayWindows.set(displayType, window);
  } else {
    displayWindows.delete(displayType);
  }
}

export function hasDisplayWindow(displayType: string): boolean {
  return displayWindows.has(displayType);
}

/** Clear all stored windows (for testing or teardown). */
export function clearDisplayWindows(): void {
  displayWindows.clear();
}
