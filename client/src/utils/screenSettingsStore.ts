/**
 * Per-screen display setting overrides, stored on the device.
 *
 * These describe one physical screen rather than the content it shows, so they
 * cannot live in the shared registry: two projectors mirroring the same display
 * may legitimately disagree about the clock, and only one of them is headless.
 *
 * Device-local storage means the override is set on the screen itself. That is
 * fine for a windowed booth machine, and is the reason a remote per-screen
 * editor (writing to the paired display device record) is the natural follow-up.
 */
import { DisplaySettings, normalizeDisplaySettings } from "./displaySettings";
import { DisplayOutputType } from "./displayOutputs";

const STORAGE_KEY = "worshipSync_screenDisplaySettings";

/**
 * Same-document change signal.
 *
 * The browser's own `storage` event only reaches *other* documents, so a
 * controller that changes a setting would not re-render itself. In Electron the
 * display window is a separate document on the same origin, so it picks up the
 * native event and the two stay in step.
 */
const CHANGE_EVENT = "worshipsync:screen-settings";

/** Subscribe to overrides changing, here or in another window on this device. */
export const subscribeToScreenSettings = (listener: () => void) => {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
};

type ScreenSettingsMap = Record<string, DisplaySettings>;

const readMap = (): ScreenSettingsMap => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ScreenSettingsMap;
  } catch {
    // Unreadable local state must never stop a screen rendering.
    return {};
  }
};

export const readScreenSettings = (
  outputId: string,
): DisplaySettings | undefined => {
  const stored = readMap()[outputId];
  return stored && typeof stored === "object" ? stored : undefined;
};

/**
 * Overrides for this screen, preferring what the server holds for the paired
 * display device.
 *
 * A paired screen is configured remotely from a controller, so the server copy
 * wins field by field. Device-local values still apply underneath, which is what
 * keeps an unpaired or ad-hoc screen configurable at all.
 */
export const resolveScreenOverrides = (
  outputId: string,
  pairedDeviceSettings?: Record<string, unknown> | null,
): DisplaySettings | undefined => {
  const local = readScreenSettings(outputId);
  if (!pairedDeviceSettings || typeof pairedDeviceSettings !== "object") {
    return local;
  }
  return { ...(local ?? {}), ...(pairedDeviceSettings as DisplaySettings) };
};

/**
 * Merge overrides for one display on this screen. Pass null to clear them and
 * fall back to the display's defaults.
 */
export const writeScreenSettings = (
  outputId: string,
  settings: DisplaySettings | null,
  type: DisplayOutputType = "projector",
): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const map = readMap();
    if (settings === null) {
      delete map[outputId];
    } else {
      const merged = { ...(map[outputId] ?? {}), ...settings };
      // isHeadless is screen-only, so it bypasses the type filter that drops
      // fields a render profile does not understand.
      const { isHeadless } = merged;
      const normalized = normalizeDisplaySettings(merged, type) ?? {};
      const next: DisplaySettings = {
        ...normalized,
        ...(isHeadless === undefined ? {} : { isHeadless }),
      };
      if (Object.keys(next).length === 0) delete map[outputId];
      else map[outputId] = next;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
};
