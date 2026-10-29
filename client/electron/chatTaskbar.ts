import { join } from "node:path";
import type { BrowserWindow, IpcMain, NativeImage } from "electron";
import { isTrustedControllerIpcSender } from "./ipcSenderAuthorization";

export type ChatTaskbarScope = {
  churchId: string;
  actorId: string;
};

export const CHAT_TASKBAR_OVERLAY_BADGES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "9+",
] as const;

export type ChatTaskbarOverlayBadge =
  (typeof CHAT_TASKBAR_OVERLAY_BADGES)[number];

export type ChatTaskbarOverlayIcons = Record<
  ChatTaskbarOverlayBadge,
  NativeImage | null
>;

export type ChatTaskbarUnreadState = {
  scope: ChatTaskbarScope | null;
  unreadCount: number;
  revision: number;
};

type TaskbarWindow = Pick<
  BrowserWindow,
  "isDestroyed" | "isFocused" | "setOverlayIcon" | "flashFrame"
>;

type ChatTaskbarController = {
  setUnreadState: (value: unknown) => boolean;
  requestAttention: (value: unknown) => boolean;
  stopFlashing: () => void;
  reset: () => void;
};

const TASKBAR_FLASH_FALLBACK_MS = 8_000;
const CHAT_TASKBAR_OVERLAY_ASSET_PREFIX = "chat-unread-overlay-";

const getOverlayAssetName = (badge: ChatTaskbarOverlayBadge) =>
  `${CHAT_TASKBAR_OVERLAY_ASSET_PREFIX}${badge === "9+" ? "9-plus" : badge}.png`;

export const findChatTaskbarOverlayIconPath = (
  options: {
    resourcesPath?: string;
    appPath: string;
    mainDirectory: string;
    exists: (path: string) => boolean;
  },
  badge: ChatTaskbarOverlayBadge,
): string | null => {
  const assetName = getOverlayAssetName(badge);
  const possiblePaths = [
    join(options.resourcesPath || options.appPath, "buildResources", assetName),
    join(options.mainDirectory, "../../buildResources", assetName),
    join(options.appPath, "buildResources", assetName),
    join(options.mainDirectory, "../buildResources", assetName),
  ];
  return possiblePaths.find(options.exists) ?? null;
};

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const isValidScope = (value: unknown): value is ChatTaskbarScope => {
  if (!value || typeof value !== "object") return false;
  const scope = value as Record<string, unknown>;
  return (
    hasOnlyKeys(scope, ["churchId", "actorId"]) &&
    typeof scope.churchId === "string" &&
    scope.churchId.trim().length > 0 &&
    scope.churchId.length <= 128 &&
    typeof scope.actorId === "string" &&
    scope.actorId.trim().length > 0 &&
    scope.actorId.length <= 128
  );
};

export const isValidChatTaskbarUnreadState = (
  value: unknown,
): value is ChatTaskbarUnreadState => {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    hasOnlyKeys(state, ["scope", "unreadCount", "revision"]) &&
    (state.scope === null || isValidScope(state.scope)) &&
    Number.isSafeInteger(state.unreadCount) &&
    Number(state.unreadCount) >= 0 &&
    (state.scope !== null || state.unreadCount === 0) &&
    Number.isSafeInteger(state.revision) &&
    Number(state.revision) > 0
  );
};

const getBadgeForUnreadCount = (
  unreadCount: number,
): ChatTaskbarOverlayBadge | null => {
  if (unreadCount <= 0) return null;
  return unreadCount >= 10
    ? "9+"
    : (String(unreadCount) as ChatTaskbarOverlayBadge);
};

const scopeKey = (scope: ChatTaskbarScope) =>
  JSON.stringify([scope.churchId, scope.actorId]);

export const createChatTaskbarController = (options: {
  platform: NodeJS.Platform | string;
  getWindow: () => TaskbarWindow | null;
  overlayIcons: ChatTaskbarOverlayIcons;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): ChatTaskbarController => {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let currentScopeKey: string | null = null;
  let currentRevision = 0;
  let currentUnreadCount = 0;
  let overlayNeedsRefresh = false;
  let isFlashing = false;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  const isWindows = options.platform === "win32";

  const stopFlashing = () => {
    if (flashTimer) {
      clearTimer(flashTimer);
      flashTimer = null;
    }
    if (!isFlashing) return;
    isFlashing = false;
    const window = options.getWindow();
    if (!window || window.isDestroyed()) return;
    try {
      window.flashFrame(false);
    } catch {
      // Renderer and window lifecycle transitions can race with taskbar APIs.
    }
  };

  const setUnreadState = (value: unknown): boolean => {
    if (!isWindows || !isValidChatTaskbarUnreadState(value)) return false;
    const window = options.getWindow();
    if (!window || window.isDestroyed() || value.revision <= currentRevision) {
      return false;
    }

    const nextScopeKey = value.scope ? scopeKey(value.scope) : null;
    const didChange =
      nextScopeKey !== currentScopeKey ||
      value.unreadCount !== currentUnreadCount ||
      overlayNeedsRefresh;
    currentRevision = value.revision;
    currentScopeKey = nextScopeKey;
    currentUnreadCount = value.unreadCount;
    if (!didChange) return true;

    const badge = getBadgeForUnreadCount(currentUnreadCount);
    try {
      window.setOverlayIcon(
        badge ? options.overlayIcons[badge] : null,
        badge ? `Unread team chat messages: ${badge}` : "",
      );
    } catch {
      // A missing or unavailable taskbar overlay must not interrupt chat.
      overlayNeedsRefresh = true;
      return false;
    }
    overlayNeedsRefresh = false;
    return true;
  };

  const requestAttention = (value: unknown): boolean => {
    if (!isWindows || !isValidScope(value)) return false;
    if (scopeKey(value) !== currentScopeKey) return false;
    const window = options.getWindow();
    if (!window || window.isDestroyed() || window.isFocused() || isFlashing) {
      return false;
    }

    try {
      window.flashFrame(true);
    } catch {
      return false;
    }
    isFlashing = true;
    flashTimer = setTimer(stopFlashing, TASKBAR_FLASH_FALLBACK_MS);
    return true;
  };

  const reset = () => {
    stopFlashing();
    currentScopeKey = null;
    currentUnreadCount = 0;
    const window = options.getWindow();
    if (!isWindows || !window || window.isDestroyed()) return;
    try {
      window.setOverlayIcon(null, "");
      overlayNeedsRefresh = false;
    } catch {
      // A destroyed renderer must not leave the main process in a bad state.
      overlayNeedsRefresh = true;
    }
  };

  return { setUnreadState, requestAttention, stopFlashing, reset };
};

export const bindChatTaskbarLifecycle = (
  window: BrowserWindow,
  controller: ChatTaskbarController,
): void => {
  window.on("focus", controller.stopFlashing);
  window.webContents.on("did-start-loading", controller.reset);
  window.webContents.on("render-process-gone", controller.reset);
  window.once("closed", controller.reset);
};

export const registerChatTaskbarIpcHandlers = (
  ipcMain: Pick<IpcMain, "handle">,
  getControllerWindow: () => BrowserWindow | null,
  controller: ChatTaskbarController,
): void => {
  ipcMain.handle("set-chat-taskbar-unread", (event, value: unknown) => {
    const window = getControllerWindow();
    if (!isTrustedControllerIpcSender(event.sender, window)) return false;
    return controller.setUnreadState(value);
  });

  ipcMain.handle("request-chat-taskbar-attention", (event, value: unknown) => {
    const window = getControllerWindow();
    if (!isTrustedControllerIpcSender(event.sender, window)) return false;
    return controller.requestAttention(value);
  });
};
