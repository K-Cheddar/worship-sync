import { BrowserWindow, shell, type WebContents } from "electron";
import { join } from "node:path";
import type { WindowType } from "./windowState";

/** Persisted session partition; must match main process and any window.open / middle-click children. */
export const WORSHIPSYNC_SESSION_PARTITION = "persist:worshipsync";

const sharedChildWindowWebPreferences = (
  electronMainDirname: string,
): Electron.WebPreferences => ({
  preload: join(electronMainDirname, "../preload/preload.mjs"),
  partition: WORSHIPSYNC_SESSION_PARTITION,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,
  backgroundThrottling: false,
});

const EXTERNAL_CHILD_WINDOW_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const OAUTH_POPUP_HOST_PATTERNS = [
  /\.firebaseapp\.com$/i,
  /\.google\.com$/i,
  /^login\.microsoftonline\.com$/i,
  /^login\.live\.com$/i,
  /^account\.live\.com$/i,
];

const shouldOpenAuthPopupInApp = (targetUrl: string): boolean => {
  try {
    const target = new URL(targetUrl);
    if (target.protocol !== "https:") return false;
    return OAUTH_POPUP_HOST_PATTERNS.some((pattern) =>
      pattern.test(target.hostname),
    );
  } catch {
    return false;
  }
};

const AUTH_HANDLER_PATH = "/__/auth/handler";
const AUTH_POPUP_CLOSE_DELAY_MS = 800;
const authPopupLifecycleAttached = new WeakSet<WebContents>();

const hasAuthCompletionSignals = (value: string): boolean => {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("code=") ||
    normalized.includes("state=") ||
    normalized.includes("oauth") ||
    normalized.includes("error=") ||
    normalized.includes("firebaseerror=")
  );
};

export const isLikelyAuthPopupCompletionUrl = (
  parentUrl: string,
  targetUrl: string,
): boolean => {
  try {
    const target = new URL(targetUrl);
    if (
      target.protocol === "about:" &&
      target.pathname.toLowerCase() === "blank"
    ) {
      return true;
    }

    if (
      target.protocol === "https:" &&
      target.pathname.toLowerCase() === AUTH_HANDLER_PATH &&
      (hasAuthCompletionSignals(target.search) ||
        hasAuthCompletionSignals(target.hash))
    ) {
      return true;
    }

    const parent = new URL(parentUrl);
    if (parent.protocol === "file:" && target.protocol === "file:") {
      return target.pathname === parent.pathname;
    }

    if (
      (parent.protocol === "https:" || parent.protocol === "http:") &&
      (target.protocol === "https:" || target.protocol === "http:")
    ) {
      return target.origin === parent.origin;
    }
  } catch {
    return false;
  }
  return false;
};

const attachAuthPopupLifecycle = (parentContents: WebContents): void => {
  if (authPopupLifecycleAttached.has(parentContents)) {
    return;
  }
  authPopupLifecycleAttached.add(parentContents);

  parentContents.on("did-create-window", (popupWindow, details) => {
    if (!shouldOpenAuthPopupInApp(details.url)) {
      return;
    }

    const safeClosePopup = () => {
      if (!popupWindow.isDestroyed()) {
        popupWindow.close();
      }
    };

    const parentWindow = BrowserWindow.fromWebContents(parentContents);
    if (parentWindow && !parentWindow.isDestroyed()) {
      parentWindow.once("closed", safeClosePopup);
    }

    popupWindow.webContents.on("did-fail-load", () => {
      safeClosePopup();
    });

    popupWindow.webContents.on("did-navigate", (_event, navigatedUrl) => {
      if (
        isLikelyAuthPopupCompletionUrl(parentContents.getURL(), navigatedUrl)
      ) {
        setTimeout(() => {
          safeClosePopup();
        }, AUTH_POPUP_CLOSE_DELAY_MS);
      }
    });
  });
};

/**
 * Only same-app child windows should inherit the WorshipSync session partition and preload.
 * External links should open in the OS browser instead of receiving app privileges.
 */
export const shouldUseSharedSessionChildWindow = (
  parentUrl: string,
  targetUrl: string,
): boolean => {
  try {
    const parent = new URL(parentUrl);
    const target = new URL(targetUrl);

    if (target.protocol === "file:") {
      return parent.protocol === "file:" && target.pathname === parent.pathname;
    }

    if (target.protocol === "http:" || target.protocol === "https:") {
      return target.origin === parent.origin;
    }

    return false;
  } catch {
    return false;
  }
};

/**
 * Child windows from window.open / middle-click do not inherit `partition` by default,
 * so they appear logged out. Force the same partition and preload as other app windows.
 */
export const setupSharedSessionWindowOpenHandler = (
  webContents: WebContents,
  electronMainDirname: string,
): void => {
  attachAuthPopupLifecycle(webContents);
  webContents.setWindowOpenHandler(({ url }) => {
    if (shouldUseSharedSessionChildWindow(webContents.getURL(), url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: sharedChildWindowWebPreferences(electronMainDirname),
        },
      };
    }

    if (shouldOpenAuthPopupInApp(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: BrowserWindow.fromWebContents(webContents) || undefined,
          modal: false,
          autoHideMenuBar: true,
          show: true,
          width: 520,
          height: 720,
          webPreferences: {
            partition: WORSHIPSYNC_SESSION_PARTITION,
            preload: undefined,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
          },
        },
      };
    }

    try {
      const target = new URL(url);
      if (EXTERNAL_CHILD_WINDOW_PROTOCOLS.has(target.protocol)) {
        void shell.openExternal(url);
      }
    } catch {
      // Ignore malformed URLs and deny the popup.
    }

    return { action: "deny" };
  });
};

interface WindowConfig {
  bounds: { x: number; y: number; width: number; height: number };
  route: string;
  isDev: boolean;
  dirname: string;
}

export const setupWindowEventListeners = (
  window: BrowserWindow,
  windowType: WindowType,
  windowStateManager: any,
  onClosed: () => void,
) => {
  // Only track when window closes to update wasOpen state
  // Since windows are always fullscreen, we don't need to track moves/resizes
  window.on("closed", onClosed);
};

export const createDisplayWindow = (config: WindowConfig): BrowserWindow => {
  const window = new BrowserWindow({
    ...config.bounds,
    webPreferences: {
      ...sharedChildWindowWebPreferences(config.dirname),
    },
    autoHideMenuBar: true,
    frame: false,
    show: false,
  });

  if (config.isDev) {
    // Ensure route starts with # for hash routing
    const hashRoute = config.route.startsWith("#")
      ? config.route
      : `#${config.route}`;
    window.loadURL(`https://local.worshipsync.net:3000${hashRoute}`);
  } else {
    window.loadFile(join(config.dirname, "../renderer/index.html"), {
      hash: config.route,
    });
  }

  return window;
};

export const setupReadyToShow = (
  window: BrowserWindow,
  windowType: WindowType,
  windowStateManager: any,
) => {
  window.once("ready-to-show", () => {
    if (window && !window.isDestroyed()) {
      window.setAlwaysOnTop(true);
      window.show();
      window.focus();
      window.moveTop();

      window.setFullScreen(true);

      // Mark window as open and save its state
      windowStateManager.saveWindowState(windowType, window);

      setTimeout(() => {
        if (!window.isDestroyed()) {
          window.setAlwaysOnTop(false);
        }
      }, 100);
    }
  });
};

export const focusWindow = (window: BrowserWindow | null): boolean => {
  if (!window || window.isDestroyed()) return false;

  // Re-assert fullscreen before focusing to prevent Windows shell UI from staying visible.
  window.setFullScreen(false);
  window.setFullScreen(true);
  window.setAlwaysOnTop(true);
  window.show();
  window.focus();
  window.moveTop();

  setTimeout(() => {
    if (!window.isDestroyed()) {
      window.setAlwaysOnTop(false);
    }
  }, 100);

  return true;
};
