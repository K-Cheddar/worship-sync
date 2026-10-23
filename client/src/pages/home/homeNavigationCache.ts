import {
  normalizeControllerIcon,
  normalizeControllerIconColor,
  type ControllerIconColor,
  type ControllerIconId,
} from "../../utils/controllerAppearance";
import {
  getControllerProfilesInNavigationOrder,
  getControllerProfileTypeForId,
  resolveHomeControllerDisplayName,
  sanitizeControllerProfileDescription,
  type ControllerProfileType,
} from "../../utils/controllerProfiles";
import { normalizeEntityIcon, type IconRef } from "../../components/icons/iconTypes";
import type { DisplayOutputType } from "../../utils/displayOutputs";

const CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_CONTROLLER_COUNT = 100;
const MAX_DISPLAY_COUNT = 100;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const DISPLAY_TYPES: readonly DisplayOutputType[] = [
  "projector",
  "monitor",
  "stream",
  "stream-info",
  "credits",
  "board",
];
const LEGACY_DEFAULT_DESCRIPTIONS: Record<ControllerProfileType, readonly string[]> = {
  presentation: [
    "Build and run the main presentation. Arrange service items, edit slides, and send output to projector, monitor, and stream.",
  ],
  overlay: [
    "Manage overlays, service timers, credits, and lower thirds for the stream.",
  ],
  "aux-presentation": [
    "Drive this screen with its own outline and content, or mirror another display.",
  ],
};

export type CachedControllerNavigation = {
  id: string;
  name: string;
  description?: string;
  icon: ControllerIconId;
  iconColor: ControllerIconColor;
  homeIcon?: IconRef;
  order: number;
};

export type CachedDisplayNavigation = {
  id: string;
  name: string;
  type: DisplayOutputType;
  order: number;
};

export type HomeNavigationMetadata = {
  churchId: string;
  controllers: CachedControllerNavigation[];
  displays: CachedDisplayNavigation[];
};

type HomeNavigationCacheRecord = HomeNavigationMetadata & {
  version: number;
  updatedAt: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const getHomeNavigationCacheKey = (churchId: string) =>
  `worshipsync.home-navigation.v${CACHE_VERSION}:${encodeURIComponent(churchId)}`;

const safeId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return SAFE_ID.test(id) ? id : null;
};

const safeName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim().slice(0, 40);
  return name || null;
};

const safeOrder = (value: unknown): number | null => {
  const order = Number(value);
  return Number.isSafeInteger(order) && order >= 0 && order <= 10000
    ? order
    : null;
};

const normalizeController = (raw: unknown): CachedControllerNavigation | null => {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const id = safeId(entry.id);
  const name = safeName(entry.name);
  const order = safeOrder(entry.order);
  if (!id || !name || order === null) return null;
  const type = getControllerProfileTypeForId(id);
  const homeIcon = normalizeEntityIcon(entry.homeIcon);
  const description = typeof entry.description === "string"
    ? sanitizeControllerProfileDescription(entry.description)
    : "";
  const descriptionIsDefault = entry.descriptionIsDefault === true ||
    (entry.descriptionIsDefault !== false &&
      LEGACY_DEFAULT_DESCRIPTIONS[type].includes(description));
  const customDescription = descriptionIsDefault ? "" : description;
  return {
    id,
    name: resolveHomeControllerDisplayName(id, name),
    icon: normalizeControllerIcon(entry.icon, type),
    iconColor: normalizeControllerIconColor(entry.iconColor, type, order),
    ...(customDescription ? { description: customDescription } : {}),
    ...(homeIcon ? { homeIcon } : {}),
    order,
  };
};

const normalizeDisplay = (raw: unknown): CachedDisplayNavigation | null => {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const id = safeId(entry.id);
  const name = safeName(entry.name);
  const order = safeOrder(entry.order);
  if (!id || !name || order === null || !DISPLAY_TYPES.includes(entry.type as DisplayOutputType)) {
    return null;
  }
  return { id, name, type: entry.type as DisplayOutputType, order };
};

export const normalizeHomeNavigationMetadata = (
  raw: unknown,
  expectedChurchId: string,
  now = Date.now(),
): HomeNavigationMetadata | null => {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<HomeNavigationCacheRecord>;
  if (
    record.version !== CACHE_VERSION ||
    record.churchId !== expectedChurchId ||
    typeof record.updatedAt !== "number" ||
    !Number.isFinite(record.updatedAt) ||
    now - record.updatedAt > CACHE_MAX_AGE_MS ||
    record.updatedAt - now > CACHE_MAX_FUTURE_SKEW_MS ||
    !Array.isArray(record.controllers) ||
    !Array.isArray(record.displays)
  ) {
    return null;
  }

  const controllers = getControllerProfilesInNavigationOrder(record.controllers
    .slice(0, MAX_CONTROLLER_COUNT)
    .map(normalizeController)
    .filter((item): item is CachedControllerNavigation => item !== null));
  const displays = record.displays
    .slice(0, MAX_DISPLAY_COUNT)
    .map(normalizeDisplay)
    .filter((item): item is CachedDisplayNavigation => item !== null)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return { churchId: expectedChurchId, controllers, displays };
};

const getStorage = (storage?: StorageLike): StorageLike | null => {
  if (storage) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const readHomeNavigationMetadata = (
  churchId: string | null | undefined,
  storage?: StorageLike,
  now = Date.now(),
): HomeNavigationMetadata | null => {
  if (!churchId) return null;
  const availableStorage = getStorage(storage);
  if (!availableStorage) return null;
  try {
    const key = getHomeNavigationCacheKey(churchId);
    const serialized = availableStorage.getItem(key);
    if (!serialized) return null;
    const raw = JSON.parse(serialized);
    const normalized = normalizeHomeNavigationMetadata(raw, churchId, now);
    if (!normalized) return null;
    const record = raw as Partial<HomeNavigationCacheRecord>;
    const cleaned = JSON.stringify({
      version: CACHE_VERSION,
      updatedAt: record.updatedAt,
      ...normalized,
    });
    if (cleaned !== serialized) {
      try {
        availableStorage.setItem(key, cleaned);
      } catch {
        // A cache migration failure must not prevent rendering normalized data.
      }
    }
    return normalized;
  } catch {
    return null;
  }
};

export const writeHomeNavigationMetadata = (
  metadata: HomeNavigationMetadata,
  storage?: StorageLike,
  now = Date.now(),
): boolean => {
  const availableStorage = getStorage(storage);
  if (!availableStorage || !metadata.churchId) return false;
  const validated = normalizeHomeNavigationMetadata(
    {
      version: CACHE_VERSION,
      updatedAt: now,
      ...metadata,
    },
    metadata.churchId,
    now,
  );
  if (!validated) return false;
  try {
    availableStorage.setItem(
      getHomeNavigationCacheKey(metadata.churchId),
      JSON.stringify({ version: CACHE_VERSION, updatedAt: now, ...validated }),
    );
    return true;
  } catch {
    return false;
  }
};
