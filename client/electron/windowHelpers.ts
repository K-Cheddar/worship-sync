import { BrowserWindow } from "electron";
import { join } from "node:path";

type WindowType = "projector" | "monitor";

interface WindowConfig {
  bounds: { x: number; y: number; width: number; height: number };
  route: string;
  isDev: boolean;
  dirname: string;
}

/**
 * Setup common event listeners for window state management
 */
export const setupWindowEventListeners = (
  window: BrowserWindow,
  windowType: WindowType,
  windowStateManager: any,
  onClosed: () => void
) => {
  // Save state when window moves or resizes
  window.on("moved", () => {
    if (!window.isDestroyed()) {
      windowStateManager.updateState(windowType, window);
    }
  });

  window.on("resized", () => {
    if (!window.isDestroyed()) {
      windowStateManager.updateState(windowType, window);
    }
  });

  window.on("enter-full-screen", () => {
    if (!window.isDestroyed()) {
      windowStateManager.updateState(windowType, window);
    }
  });

  window.on("leave-full-screen", () => {
    if (!window.isDestroyed()) {
      windowStateManager.updateState(windowType, window);
    }
  });

  window.on("closed", onClosed);
};

/**
 * Create a display window (projector or monitor) with common configuration
 */
export const createDisplayWindow = (config: WindowConfig): BrowserWindow => {
  const window = new BrowserWindow({
    ...config.bounds,
    webPreferences: {
      preload: join(config.dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
    autoHideMenuBar: true,
    frame: false,
    show: false,
    icon: join(config.dirname, "../dist/WorshipSyncIcon.png"),
  });

  // Load the appropriate page
  if (config.isDev) {
    window.loadURL(`https://local.worshipsync.net:3000#${config.route}`);
  } else {
    const indexPath = join(config.dirname, "../dist/index.html");
    window.loadFile(indexPath, { hash: config.route });
  }

  return window;
};

/**
 * Setup window ready-to-show event with fullscreen
 */
export const setupReadyToShow = (window: BrowserWindow) => {
  window.once("ready-to-show", () => {
    if (window && !window.isDestroyed()) {
      // Temporarily set always on top to force window to foreground
      window.setAlwaysOnTop(true);
      window.show();
      window.focus();
      window.moveTop();

      // Always set fullscreen for display windows
      window.setFullScreen(true);

      // Remove always on top after a brief delay
      setTimeout(() => {
        if (window && !window.isDestroyed()) {
          window.setAlwaysOnTop(false);
        }
      }, 100);
    }
  });
};

/**
 * Focus a window and bring it to foreground
 */
export const focusWindow = (window: BrowserWindow | null): boolean => {
  if (!window || window.isDestroyed()) {
    return false;
  }

  // Temporarily set always on top to force window to foreground
  window.setAlwaysOnTop(true);
  window.show();
  window.focus();
  window.moveTop();

  // Remove always on top after a brief delay
  setTimeout(() => {
    if (window && !window.isDestroyed()) {
      window.setAlwaysOnTop(false);
    }
  }, 100);

  return true;
};
