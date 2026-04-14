import type {
  ControllerItemMediaRouteKey,
  ItemType,
  MediaRouteKey,
} from "../types";

/** Keys under `/controller/item/...` (iterate for repairs / migrations). */
export const CONTROLLER_ITEM_MEDIA_ROUTE_KEYS: ControllerItemMediaRouteKey[] = [
  "controller-item-song",
  "controller-item-free",
  "controller-item-bible",
  "controller-item-timer",
  "controller-item-image",
  "controller-item-heading",
  "controller-item-unknown",
];

const LEGACY_SETTINGS_MEDIA_ROUTE_KEYS = [
  "controller-preferences",
  "controller-quick-links",
  "controller-monitor-settings",
] as const;

/** All keys used for `preferences.mediaRouteFolders` (iterate for repairs / migrations). */
export const MEDIA_ROUTE_KEYS: MediaRouteKey[] = [
  "controller-default",
  ...CONTROLLER_ITEM_MEDIA_ROUTE_KEYS,
  "controller-overlays",
  "controller-settings",
  "overlay-controller",
];

type PageMode = "default" | "overlayController";

export function controllerItemMediaRouteKey(
  itemType: ItemType,
): ControllerItemMediaRouteKey {
  if (itemType === "") return "controller-item-unknown";
  switch (itemType) {
    case "song":
      return "controller-item-song";
    case "free":
      return "controller-item-free";
    case "bible":
      return "controller-item-bible";
    case "timer":
      return "controller-item-timer";
    case "image":
      return "controller-item-image";
    case "heading":
      return "controller-item-heading";
    default:
      return "controller-item-unknown";
  }
}

/**
 * Normalize stored `mediaRouteFolders`: legacy `controller-item` and separate
 * settings-tab keys are merged into current {@link MEDIA_ROUTE_KEYS} shape.
 */
export function migrateLegacyMediaRouteFolders(
  raw: Partial<Record<string, string | null>>,
): Partial<Record<MediaRouteKey, string | null>> {
  const next: Partial<Record<string, string | null>> = { ...raw };
  const legacy = next["controller-item"];
  if (legacy !== undefined) {
    for (const key of CONTROLLER_ITEM_MEDIA_ROUTE_KEYS) {
      if (next[key] === undefined) {
        next[key] = legacy;
      }
    }
    delete next["controller-item"];
  }
  // Prefer preferences, then quick-links, then monitor-settings (deterministic).
  if (next["controller-settings"] === undefined) {
    for (const key of LEGACY_SETTINGS_MEDIA_ROUTE_KEYS) {
      const v = next[key];
      if (v !== undefined) {
        next["controller-settings"] = v;
        break;
      }
    }
  }
  for (const key of LEGACY_SETTINGS_MEDIA_ROUTE_KEYS) {
    delete next[key];
  }
  return next as Partial<Record<MediaRouteKey, string | null>>;
}

/**
 * Map URL + page context (+ active item type on item routes) to persisted
 * media-folder route key. Paths are absolute (e.g. `/controller/item/...`,
 * `/overlay-controller`).
 */
export function getMediaRouteKey(
  pathname: string,
  pageMode: PageMode = "default",
  itemType?: ItemType,
): MediaRouteKey {
  if (pathname === "/overlay-controller" || pageMode === "overlayController") {
    return "overlay-controller";
  }
  if (pathname.includes("/controller/item/")) {
    return controllerItemMediaRouteKey(itemType ?? "");
  }
  if (pathname.includes("/controller/overlays")) return "controller-overlays";
  if (
    pathname.includes("/controller/preferences") ||
    pathname.includes("/controller/quick-links") ||
    pathname.includes("/controller/monitor-settings")
  ) {
    return "controller-settings";
  }
  return "controller-default";
}
