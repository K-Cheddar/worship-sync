import { BrowserWindow, shell, type WebContents } from "electron";
import { join } from "node:path";
import type { WindowType } from "./windowState";

/** Persisted session partition; must match main process and any window.open / middle-click children. */
export const WORSHIPSYNC_SESSION_PARTITION = "persist:worshipsync";

const sharedChildWindowWebPreferences = (
  electronMainDirname: string
): Electron.WebPreferences => ({
  preload: join(electronMainDirname, "../preload/preload.mjs"),
  partition: WORSHIPSYNC_SESSION_PARTITION,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,
  backgroundThrottling: false,
});

const EXTERNAL_CHILD_WINDOW_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Only same-app child windows should inherit the WorshipSync session partition and preload.
 * External links should open in the OS browser instead of receiving app privileges.
 */
export const shouldUseSharedSessionChildWindow = (
  parentUrl: string,
  targetUrl: string
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
  electronMainDirname: string
): void => {
  webContents.setWindowOpenHandler(({ url }) => {
    if (shouldUseSharedSessionChildWindow(webContents.getURL(), url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: sharedChildWindowWebPreferences(electronMainDirname),
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
  onClosed: () => void
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
    const hashRoute = config.route.startsWith("#") ? config.route : `#${config.route}`;
    window.loadURL(`https://local.worshipsync.net:3000${hashRoute}`);
  } else {
    window.loadFile(
      join(config.dirname, "../renderer/index.html"),
      { hash: config.route }
    );
  }

  return window;
};

export const setupReadyToShow = (
  window: BrowserWindow,
  windowType: WindowType,
  windowStateManager: any
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
