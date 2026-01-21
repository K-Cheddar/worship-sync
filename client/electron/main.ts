import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { autoUpdater } from "electron-updater";
import { WindowStateManager } from "./windowState";
import {
  createDisplayWindow,
  setupWindowEventListeners,
  setupReadyToShow,
  focusWindow,
} from "./windowHelpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

// Allow self-signed certificates in development
if (isDev) {
  app.commandLine.appendSwitch("ignore-certificate-errors");
  app.commandLine.appendSwitch("ignore-ssl-errors");
}

let mainWindow: BrowserWindow | null = null;
let projectorWindow: BrowserWindow | null = null;
let monitorWindow: BrowserWindow | null = null;
let windowStateManager: WindowStateManager;

const notifyWindowStateChanged = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("window-state-changed");
  }
};

const createProjectorWindow = () => {
  if (projectorWindow) {
    projectorWindow.focus();
    return;
  }

  const display = windowStateManager.getDisplayForWindow("projector");
  const bounds = windowStateManager.getWindowBounds("projector", display);

  projectorWindow = createDisplayWindow({
    bounds,
    route: "/projector-full",
    isDev,
    dirname: __dirname,
  });

  setupReadyToShow(projectorWindow);

  setupWindowEventListeners(
    projectorWindow,
    "projector",
    windowStateManager,
    () => {
      projectorWindow = null;
      notifyWindowStateChanged();
    }
  );
};

const createMonitorWindow = () => {
  if (monitorWindow) {
    monitorWindow.focus();
    return;
  }

  const display = windowStateManager.getDisplayForWindow("monitor");
  const bounds = windowStateManager.getWindowBounds("monitor", display);

  monitorWindow = createDisplayWindow({
    bounds,
    route: "/monitor",
    isDev,
    dirname: __dirname,
  });

  setupReadyToShow(monitorWindow);

  setupWindowEventListeners(
    monitorWindow,
    "monitor",
    windowStateManager,
    () => {
      monitorWindow = null;
      notifyWindowStateChanged();
    }
  );
};

const createWindow = () => {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
    autoHideMenuBar: true,
    icon: join(__dirname, "../dist/WorshipSyncIcon.png"),
  });

  // Maximize the window before showing
  mainWindow.maximize();
  mainWindow.show();

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL("https://local.worshipsync.net:3000");
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from the built files
    // Use app.getAppPath() for reliable path resolution in packaged apps
    const appPath = app.getAppPath();
    const indexPath = join(appPath, "dist", "index.html");
    
    console.log("App path:", appPath);
    console.log("Index path:", indexPath);
    console.log("__dirname:", __dirname);
    console.log("isPackaged:", app.isPackaged);
    
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error("Failed to load index.html:", err);
    });
  }

  // Log any errors
  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    console.error("Failed to load:", errorCode, errorDescription);
  });

  mainWindow.webContents.on("console-message", (event, level, message) => {
    console.log("Console:", message);
  });

  // When main window is ready, open projector and monitor windows
  mainWindow.webContents.once("did-finish-load", () => {
    // Delay slightly to ensure main window is fully loaded
    setTimeout(() => {
      createProjectorWindow();
      createMonitorWindow();
    }, 500);
  });

  mainWindow.on("closed", () => {
    // Close projector and monitor windows when main window closes
    if (projectorWindow) {
      projectorWindow.close();
      projectorWindow = null;
    }
    if (monitorWindow) {
      monitorWindow.close();
      monitorWindow = null;
    }
    mainWindow = null;
  });
};

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  windowStateManager = new WindowStateManager();
  createWindow();

  // Configure auto-updater (only in production)
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
    
    // Check for updates every hour
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 60 * 60 * 1000);

    // Log update events
    autoUpdater.on("update-available", () => {
      console.log("Update available");
    });

    autoUpdater.on("update-downloaded", () => {
      console.log("Update downloaded - will install on quit");
    });

    autoUpdater.on("error", (error) => {
      console.error("Auto-updater error:", error);
    });
  }

  app.on("activate", () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC handlers for Electron-specific functionality
ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("get-platform", () => {
  return process.platform;
});

ipcMain.handle("is-electron", () => {
  return true;
});

ipcMain.handle("is-dev", () => {
  return isDev;
});

// Window management IPC handlers
ipcMain.handle("open-projector-window", () => {
  createProjectorWindow();
  return true;
});

ipcMain.handle("open-monitor-window", () => {
  createMonitorWindow();
  return true;
});

ipcMain.handle("focus-projector-window", () => focusWindow(projectorWindow));
ipcMain.handle("focus-monitor-window", () => focusWindow(monitorWindow));

ipcMain.handle("close-projector-window", () => {
  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.close();
    return true;
  }
  return false;
});

ipcMain.handle("close-monitor-window", () => {
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    monitorWindow.close();
    return true;
  }
  return false;
});

const toggleFullscreen = (window: BrowserWindow | null): boolean => {
  if (window && !window.isDestroyed()) {
    const isFullScreen = window.isFullScreen();
    window.setFullScreen(!isFullScreen);
    return !isFullScreen;
  }
  return false;
};

ipcMain.handle("toggle-projector-fullscreen", () => toggleFullscreen(projectorWindow));
ipcMain.handle("toggle-monitor-fullscreen", () => toggleFullscreen(monitorWindow));

ipcMain.handle("get-displays", () => {
  const displays = screen.getAllDisplays();
  return displays.map((display) => ({
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: display.internal,
    label: display.label,
  }));
});

const moveWindowToDisplay = (
  window: BrowserWindow | null,
  windowType: "projector" | "monitor",
  displayId: number
): boolean => {
  if (!window || window.isDestroyed()) return false;

  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find((d) => d.id === displayId);

  if (!targetDisplay) return false;

  window.setBounds({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
  });

  windowStateManager.updateState(windowType, window);
  return true;
};

ipcMain.handle("move-projector-to-display", (_event, displayId: number) =>
  moveWindowToDisplay(projectorWindow, "projector", displayId)
);

ipcMain.handle("move-monitor-to-display", (_event, displayId: number) =>
  moveWindowToDisplay(monitorWindow, "monitor", displayId)
);

ipcMain.handle("get-window-states", () => {
  const projectorState = windowStateManager.getState("projector");
  const monitorState = windowStateManager.getState("monitor");
  
  // Get the actual current fullscreen state from the windows
  if (projectorWindow) {
    projectorState.isFullScreen = projectorWindow.isFullScreen();
  }
  if (monitorWindow) {
    monitorState.isFullScreen = monitorWindow.isFullScreen();
  }
  
  return {
    projector: projectorState,
    monitor: monitorState,
    projectorOpen: projectorWindow !== null,
    monitorOpen: monitorWindow !== null,
  };
});

// Auto-updater IPC handlers
ipcMain.handle("check-for-updates", async () => {
  if (isDev) {
    return { available: false, message: "Updates disabled in development" };
  }
  
  try {
    const result = await autoUpdater.checkForUpdates();
    return { 
      available: result !== null,
      updateInfo: result?.updateInfo 
    };
  } catch (error) {
    console.error("Error checking for updates:", error);
    return { available: false, error: error.message };
  }
});

ipcMain.handle("install-update", () => {
  if (!isDev) {
    autoUpdater.quitAndInstall();
  }
});
