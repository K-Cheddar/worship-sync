import { app, BrowserWindow, ipcMain, screen, protocol } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, createReadStream, statSync } from "node:fs";
import { createServer, Server } from "node:http";
import updaterPkg from "electron-updater";

import { WindowStateManager } from "./windowState";
import {
  createDisplayWindow,
  setupWindowEventListeners,
  setupReadyToShow,
  focusWindow,
} from "./windowHelpers";
import { VideoCacheManager } from "./videoCache";

const { autoUpdater } = updaterPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

/**
 * Get the icon path for the current platform
 * Tries multiple locations to find the icon file
 */
const getIconPath = (): string | undefined => {
  const iconName = process.platform === "win32" ? "icon.ico" : "icon.png";
  
  // Try different paths in order of preference
  const possiblePaths = [
    // Production: electron-builder puts buildResources in app resources
    join(process.resourcesPath || app.getAppPath(), "buildResources", iconName),
    // Development: from dist-electron/main, go up to client/buildResources
    join(__dirname, "../../buildResources", iconName),
    // Alternative: from app path
    join(app.getAppPath(), "buildResources", iconName),
    // Fallback: try relative to __dirname
    join(__dirname, "../buildResources", iconName),
  ];

  // Return the first path that exists
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If no icon found, return undefined (Electron will use default)
  console.warn(`Icon not found. Tried paths: ${possiblePaths.join(", ")}`);
  return undefined;
};

// Allow self-signed certificates in development
if (isDev) {
  app.commandLine.appendSwitch("ignore-certificate-errors");
  app.commandLine.appendSwitch("ignore-ssl-errors");
}

// Register custom protocol scheme as privileged (must be done before app is ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: "video-cache",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true, // Required for video elements to work with custom protocols
      bypassCSP: true, // Bypass CSP for custom protocol
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let projectorWindow: BrowserWindow | null = null;
let monitorWindow: BrowserWindow | null = null;
let windowStateManager: WindowStateManager;
let videoCacheManager: VideoCacheManager;
let videoCacheServer: Server | null = null;
let videoCacheServerPort: number = 0;

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
      windowStateManager.markWindowClosed("projector");
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
      windowStateManager.markWindowClosed("monitor");
      monitorWindow = null;
      notifyWindowStateChanged();
    }
  );
};

const createWindow = () => {
  // Create the browser window
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
      webPreferences: {
        preload: join(__dirname, "../preload/preload.mjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    autoHideMenuBar: !isDev, // Hide menu bar in production
    ...(iconPath && { icon: iconPath }), // Only set icon if found
  });

  // Maximize the window before showing
  mainWindow.maximize();
  mainWindow.show();

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL("https://local.worshipsync.net:3000");
    // Open DevTools in development only
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from the built files
    // electron-vite outputs renderer to dist-electron/renderer/
    const indexPath = join(__dirname, "../renderer/index.html");
    
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error("Failed to load index.html:", err);
    });
  }

  // Log errors (only in development)
  if (isDev) {
    mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      console.error("Failed to load:", errorCode, errorDescription);
    });

    mainWindow.webContents.on("console-message", (event, level, message) => {
      console.log("Console:", message);
    });
  }

  // When main window is ready, open projector and monitor windows only if they were previously open
  mainWindow.webContents.once("did-finish-load", () => {
    // Delay slightly to ensure main window is fully loaded
    setTimeout(() => {
      // Only open windows if they were open when app last closed
      if (windowStateManager.wasWindowOpen("projector")) {
        createProjectorWindow();
      }
      if (windowStateManager.wasWindowOpen("monitor")) {
        createMonitorWindow();
      }
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
  // Create local HTTP server for video cache (more compatible than custom protocol)
  const cacheDir = join(app.getPath("userData"), "video-cache");
  
  videoCacheServer = createServer((req, res) => {
    try {
      // Handle CORS preflight requests
      if (req.method === "OPTIONS") {
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range",
        });
        res.end();
        return;
      }

      if (!req.url) {
        res.writeHead(400);
        res.end("Bad Request");
        return;
      }

      // Parse the filename from the URL (e.g., /j83fap.mp4)
      const filename = req.url.split("?")[0].replace(/^\//, "");
      if (!filename || filename.includes("..") || filename.includes("/")) {
        res.writeHead(400);
        res.end("Invalid filename");
        return;
      }

      const filePath = join(cacheDir, filename);
      
      // Security check: ensure the file is in the video cache directory
      const normalizedFilePath = filePath.replace(/\\/g, "/").toLowerCase();
      const normalizedCacheDir = cacheDir.replace(/\\/g, "/").toLowerCase();
      
      if (!normalizedFilePath.startsWith(normalizedCacheDir)) {
        console.error(`[Video Cache Server] Security violation: Attempted to access file outside cache directory`);
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      // Check if file exists
      if (!existsSync(filePath)) {
        console.warn(`[Video Cache Server] File not found: ${filePath}`);
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      // Get file stats for content length and range support
      const stats = statSync(filePath);
      const fileSize = stats.size;
      
      // Support range requests for video seeking
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = createReadStream(filePath, { start, end });
        
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "video/mp4",
        });
        file.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": "video/mp4",
        });
        createReadStream(filePath).pipe(res);
      }
    } catch (error) {
      console.error(`[Video Cache Server] Error serving file: ${req.url}`, error);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  // Start server on a random available port
  videoCacheServer.listen(0, "127.0.0.1", () => {
    const address = videoCacheServer?.address();
    if (address && typeof address === "object") {
      videoCacheServerPort = address.port;
      console.log(`[Video Cache Server] Started on http://127.0.0.1:${videoCacheServerPort}`);
    }
  });

  videoCacheServer.on("error", (error) => {
    console.error("[Video Cache Server] Error:", error);
  });

  windowStateManager = new WindowStateManager();
  videoCacheManager = new VideoCacheManager();
  createWindow();

  // Configure auto-updater (only in production)
  if (!isDev) {
    // Don't use checkForUpdatesAndNotify() - we'll handle UI ourselves
    autoUpdater.autoDownload = false; // Don't auto-download, let user choose
    
    // Check for updates every hour
    setInterval(() => {
      autoUpdater.checkForUpdates();
    }, 60 * 60 * 1000);

    // Initial check
    autoUpdater.checkForUpdates();

    // Send update events to renderer
    autoUpdater.on("update-available", (info) => {
      console.log("Update available:", info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-available", {
          version: info.version,
          releaseDate: info.releaseDate,
        });
      }
    });

    autoUpdater.on("update-downloaded", (info) => {
      console.log("Update downloaded:", info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-downloaded", {
          version: info.version,
          releaseDate: info.releaseDate,
        });
      }
    });

    autoUpdater.on("download-progress", (progressObj) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-download-progress", {
          percent: progressObj.percent,
          transferred: progressObj.transferred,
          total: progressObj.total,
        });
      }
    });

    autoUpdater.on("error", (error) => {
      console.error("Auto-updater error:", error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-error", {
          message: error.message,
        });
      }
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

// Clean up video cache server on app quit
app.on("before-quit", () => {
  if (videoCacheServer) {
    videoCacheServer.close(() => {
      console.log("[Video Cache Server] Closed");
    });
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
  } catch (error: any) {
    console.error("Error checking for updates:", error);
    return { available: false, error: error.message };
  }
});

ipcMain.handle("download-update", () => {
  if (!isDev) {
    autoUpdater.downloadUpdate();
    return true;
  }
  return false;
});

ipcMain.handle("install-update", () => {
  if (!isDev) {
    autoUpdater.quitAndInstall();
  }
});

// Video cache IPC handlers
ipcMain.handle("download-video", async (_event, url: string) => {
  if (!videoCacheManager) {
    return null;
  }
  try {
    return await videoCacheManager.downloadVideo(url);
  } catch (error) {
    console.error("Error downloading video:", error);
    return null;
  }
});

ipcMain.handle("get-local-video-path", (_event, url: string) => {
  if (!videoCacheManager) {
    return null;
  }
  const localPath = videoCacheManager.getLocalPath(url);
  if (!localPath) {
    return null;
  }
  
  // If it's already a URL (http://), return as-is
  if (localPath.startsWith("http://") || localPath.startsWith("https://")) {
    return localPath;
  }
  
  // Convert file path to HTTP URL served by local server
  if (videoCacheServerPort > 0) {
    // Extract just the filename from the path
    const filename = localPath.split(/[/\\]/).pop();
    if (filename) {
      return `http://127.0.0.1:${videoCacheServerPort}/${filename}`;
    }
  }
  
  return null;
});

ipcMain.handle("cleanup-unused-videos", async (_event, usedUrls: string[]) => {
  if (!videoCacheManager) {
    return;
  }
  try {
    await videoCacheManager.cleanupUnusedVideos(new Set(usedUrls));
  } catch (error) {
    console.error("Error cleaning up videos:", error);
  }
});

ipcMain.handle("sync-video-cache", async (_event, videoUrls: string[]) => {
  if (!videoCacheManager) {
    return { downloaded: 0, cleaned: 0 };
  }
  try {
    const usedUrls = new Set(videoUrls);
    let downloaded = 0;

    // Download all videos
    for (const url of videoUrls) {
      const localPath = videoCacheManager.getLocalPath(url);
      if (!localPath) {
        try {
          const downloadedPath = await videoCacheManager.downloadVideo(url);
          if (downloadedPath) {
            downloaded++;
          }
          // If downloadVideo returns null (e.g., 404), it's handled gracefully
        } catch (error) {
          // Log but continue - some videos might not be downloadable
          console.warn(`Could not download video ${url}:`, error);
        }
      }
    }

    // Clean up unused videos
    const beforeCleanup = videoCacheManager.getAllCachedUrls().length;
    await videoCacheManager.cleanupUnusedVideos(usedUrls);
    const afterCleanup = videoCacheManager.getAllCachedUrls().length;
    const cleaned = beforeCleanup - afterCleanup;

    return { downloaded, cleaned };
  } catch (error) {
    console.error("Error syncing video cache:", error);
    return { downloaded: 0, cleaned: 0 };
  }
});
