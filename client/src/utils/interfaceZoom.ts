/** Shared operator UI zoom (root rem scale). Persists across pages via localStorage. */

export const INTERFACE_ZOOM_STORAGE_KEY = "worship-sync-interface-zoom";
export const INTERFACE_ZOOM_BASE_PERCENT = 100;
export const INTERFACE_ZOOM_MIN = 50;
export const INTERFACE_ZOOM_MAX = 200;
export const INTERFACE_ZOOM_STEP = 10;

const listeners = new Set<() => void>();

const clampZoom = (value: number) => {
  const stepped = Math.round(value / INTERFACE_ZOOM_STEP) * INTERFACE_ZOOM_STEP;
  return Math.min(INTERFACE_ZOOM_MAX, Math.max(INTERFACE_ZOOM_MIN, stepped));
};

const readStoredZoom = (): number => {
  try {
    const raw = localStorage.getItem(INTERFACE_ZOOM_STORAGE_KEY);
    if (raw == null) return INTERFACE_ZOOM_BASE_PERCENT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return INTERFACE_ZOOM_BASE_PERCENT;
    return clampZoom(parsed);
  } catch {
    return INTERFACE_ZOOM_BASE_PERCENT;
  }
};

let zoomLevel = readStoredZoom();

const writeStoredZoom = (level: number) => {
  try {
    localStorage.setItem(INTERFACE_ZOOM_STORAGE_KEY, String(level));
  } catch {
    // Ignore quota / private-mode failures; in-memory zoom still works.
  }
};

export const getInterfaceZoomSnapshot = () => zoomLevel;

export const subscribeInterfaceZoom = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const applyInterfaceZoomToDocument = (level: number = zoomLevel) => {
  if (typeof document === "undefined") return;
  const scale = level / 100;
  document.documentElement.style.fontSize = `${INTERFACE_ZOOM_BASE_PERCENT * scale}%`;
};

export const setInterfaceZoom = (next: number) => {
  const clamped = clampZoom(next);
  if (clamped === zoomLevel) {
    applyInterfaceZoomToDocument(clamped);
    return;
  }
  zoomLevel = clamped;
  writeStoredZoom(clamped);
  applyInterfaceZoomToDocument(clamped);
  listeners.forEach((listener) => listener());
};

export const resetInterfaceZoom = () => {
  setInterfaceZoom(INTERFACE_ZOOM_BASE_PERCENT);
};

/** Test helper: reset module state without touching document. */
export const __resetInterfaceZoomForTests = () => {
  zoomLevel = INTERFACE_ZOOM_BASE_PERCENT;
  listeners.clear();
  try {
    localStorage.removeItem(INTERFACE_ZOOM_STORAGE_KEY);
  } catch {
    // ignore
  }
};
