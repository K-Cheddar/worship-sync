import { BrowserWindow } from "electron";
import { join } from "node:path";
import type { WindowType } from "./windowState";

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
      preload: join(config.dirname, "../preload/preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
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
