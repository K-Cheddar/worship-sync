/**
 * Controller publishes which local video inputs should stay warm because they
 * appear on the current service list (or the open item). Electron CaptureHost
 * does not load itemList, so it reads this channel / localStorage instead.
 * Same-window listeners are required because BroadcastChannel and the storage
 * event do not notify the tab that wrote the value.
 */

const CHANNEL_NAME = "worshipsync-local-video-warm-intent-v1";
const STORAGE_KEY = "worshipsync_local_video_warm_sources";

export type LocalVideoWarmIntent = {
  sourceIds: string[];
  updatedAt: number;
};

type WarmIntentListener = (intent: LocalVideoWarmIntent) => void;

const normalizeSourceIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return [...new Set(ids)].sort();
};

const readStoredIntent = (): LocalVideoWarmIntent => {
  if (typeof localStorage === "undefined") {
    return { sourceIds: [], updatedAt: 0 };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sourceIds: [], updatedAt: 0 };
    const parsed = JSON.parse(raw) as Partial<LocalVideoWarmIntent>;
    return {
      sourceIds: normalizeSourceIds(parsed.sourceIds),
      updatedAt:
        typeof parsed.updatedAt === "number" &&
        Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : 0,
    };
  } catch {
    return { sourceIds: [], updatedAt: 0 };
  }
};

let lastPublishedKey = "";
let publisherChannel: BroadcastChannel | undefined;
const localListeners = new Set<WarmIntentListener>();

const intentKey = (intent: LocalVideoWarmIntent) =>
  intent.sourceIds.join("\u0000");

const notifyLocalListeners = (intent: LocalVideoWarmIntent) => {
  localListeners.forEach((listener) => listener(intent));
};

/** Replace the workstation warm set for list / editor readiness. */
export const publishLocalVideoWarmIntent = (sourceIds: string[]) => {
  const intent: LocalVideoWarmIntent = {
    sourceIds: normalizeSourceIds(sourceIds),
    updatedAt: Date.now(),
  };
  const key = intentKey(intent);
  const storedKey = intentKey(readStoredIntent());
  // After a restart, lastPublishedKey is empty while localStorage may still
  // hold a prior warm set — still publish so empty clears stale IDs.
  if (key === lastPublishedKey && key === storedKey) {
    return intent;
  }
  lastPublishedKey = key;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Quota / private mode — still try BroadcastChannel for live windows.
  }
  notifyLocalListeners(intent);
  if (typeof BroadcastChannel !== "undefined") {
    publisherChannel ??= new BroadcastChannel(CHANNEL_NAME);
    publisherChannel.postMessage(intent);
  }
  return intent;
};

export const readLocalVideoWarmIntent = (): LocalVideoWarmIntent =>
  readStoredIntent();

export const subscribeLocalVideoWarmIntent = (onIntent: WarmIntentListener) => {
  onIntent(readStoredIntent());
  localListeners.add(onIntent);
  let channel: BroadcastChannel | undefined;
  const onMessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<LocalVideoWarmIntent>;
    if (!data || typeof data !== "object") return;
    const intent: LocalVideoWarmIntent = {
      sourceIds: normalizeSourceIds(data.sourceIds),
      updatedAt:
        typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
          ? data.updatedAt
          : Date.now(),
    };
    lastPublishedKey = intentKey(intent);
    onIntent(intent);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const intent = readStoredIntent();
    lastPublishedKey = intentKey(intent);
    onIntent(intent);
  };
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", onMessage);
  }
  window.addEventListener("storage", onStorage);
  return () => {
    localListeners.delete(onIntent);
    channel?.removeEventListener("message", onMessage);
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    publisherChannel?.close();
    publisherChannel = undefined;
  });
}
