import { app, BrowserWindow, ipcMain, screen, protocol, session, dialog } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, createReadStream, statSync, readFileSync, writeFileSync } from "node:fs";
import updaterPkg from "electron-updater";

import { WindowStateManager, type WindowType } from "./windowState";
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

// Set different userData path in development to separate dev and production data
if (!app.isPackaged) {
  app.setPath("userData", join(app.getPath("userData"), "dev"));
}

let mainWindow: BrowserWindow | null = null;
let projectorWindow: BrowserWindow | null = null;
let monitorWindow: BrowserWindow | null = null;
let windowStateManager: WindowStateManager;
let videoCacheManager: VideoCacheManager;
let isUploadInProgress = false;
let isAppClosing = false;

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
  const bounds = windowStateManager.getWindowBounds(display);

  const newWindow = createDisplayWindow({
    bounds,
    route: "/projector-full",
    isDev,
    dirname: __dirname,
  });

  setWindowByType("projector", newWindow);

  setupReadyToShow(newWindow, "projector", windowStateManager);

  setupWindowEventListeners(
    newWindow,
    "projector",
    windowStateManager,
    () => {
      // Only mark as closed if app is not closing (user manually closed the window)
      if (!isAppClosing) {
        windowStateManager.markWindowClosed("projector");
      }
      setWindowByType("projector", null);
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
  const bounds = windowStateManager.getWindowBounds(display);

  const newWindow = createDisplayWindow({
    bounds,
    route: "/monitor",
    isDev,
    dirname: __dirname,
  });

  setWindowByType("monitor", newWindow);

  setupReadyToShow(newWindow, "monitor", windowStateManager);

  setupWindowEventListeners(
    newWindow,
    "monitor",
    windowStateManager,
    () => {
      // Only mark as closed if app is not closing (user manually closed the window)
      if (!isAppClosing) {
        windowStateManager.markWindowClosed("monitor");
      }
      setWindowByType("monitor", null);
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

  // Handle window close - check for upload in progress
  mainWindow.on("close", async (event) => {
    if (isUploadInProgress) {
      event.preventDefault();
      
      const result = await dialog.showMessageBox(mainWindow!, {
        type: "warning",
        title: "Upload in Progress",
        message: "A video upload is currently in progress.",
        detail: "If you close the app now, your upload will be cancelled and you may lose progress. Do you want to close anyway?",
        buttons: ["Cancel", "Close Anyway"],
        defaultId: 0,
        cancelId: 0,
      });

      if (result.response === 1) {
        // User chose to close anyway
        isUploadInProgress = false;
        isAppClosing = true;
        // Save window states before closing (preserve wasOpen: true)
        if (projectorWindow && !projectorWindow.isDestroyed()) {
          windowStateManager.saveWindowState("projector", projectorWindow);
        }
        if (monitorWindow && !monitorWindow.isDestroyed()) {
          windowStateManager.saveWindowState("monitor", monitorWindow);
        }
        // Close projector and monitor windows
        if (projectorWindow) {
          projectorWindow.close();
          setWindowByType("projector", null);
        }
        if (monitorWindow) {
          monitorWindow.close();
          setWindowByType("monitor", null);
        }
        // Actually close the window
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
        mainWindow = null;
      }
      // If user chose Cancel (response === 0), do nothing - window stays open
    } else {
      // No upload in progress, close normally
      isAppClosing = true;
      // Save window states before closing (preserve wasOpen: true)
      if (projectorWindow && !projectorWindow.isDestroyed()) {
        windowStateManager.saveWindowState("projector", projectorWindow);
      }
      if (monitorWindow && !monitorWindow.isDestroyed()) {
        windowStateManager.saveWindowState("monitor", monitorWindow);
      }
      // Close projector and monitor windows
      if (projectorWindow) {
        projectorWindow.close();
        setWindowByType("projector", null);
      }
      if (monitorWindow) {
        monitorWindow.close();
        setWindowByType("monitor", null);
      }
      mainWindow = null;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Set Content Security Policy to prevent security warnings
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' https://portable-media.firebaseio.com; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com data:; " +
          "img-src 'self' data: https: http:; " +
          "media-src 'self' https: http: blob: video-cache:; " +
          "connect-src 'self' https: http: ws: wss:; " +
          "frame-src 'self'; " +
          "object-src 'none'; " +
          "base-uri 'self'; " +
          "worker-src 'self' blob:;"
        ],
      },
    });
  });

  // Register protocol handler for video-cache:// to serve files from filesystem
  const cacheDir = join(app.getPath("userData"), "video-cache");
  
  protocol.handle("video-cache", async (request) => {
    try {
      const url = new URL(request.url);
      // For video-cache:// URLs, filename can be in hostname (video-cache://filename.mp4) 
      // or pathname (video-cache:///filename.mp4)
      // Extract from pathname first, then hostname, or parse from the full URL as fallback
      let filename = url.pathname.replace(/^\//, "").replace(/\/$/, "");
      if (!filename) {
        filename = url.hostname || "";
      }
      // If still empty, try to extract from the URL string directly
      if (!filename) {
        const urlMatch = request.url.match(new RegExp("video-cache:///?([^/?#]+)"));
        if (urlMatch) {
          filename = urlMatch[1];
        }
      }
      const filePath = join(cacheDir, filename);

      if (!existsSync(filePath)) {
        return new Response("Not Found", { status: 404 });
      }
  
      const stat = statSync(filePath);
      const fileSize = stat.size;
  
      // Electron quirk: request.headers is a plain object, not a Headers instance
      const rangeHeader =
        (request.headers as any)["range"] ||
        (request.headers as any)["Range"];

  
      if (rangeHeader) {
        const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
        const chunkSize = end - start + 1;
  
        const nodeStream = createReadStream(filePath, { start, end });
  
        // Convert Node stream → Web ReadableStream
        const webStream = new ReadableStream({
          start(controller) {
            let isClosed = false;
            
            const safeClose = () => {
              if (!isClosed) {
                isClosed = true;
                try {
                  controller.close();
                } catch (err) {
                  // Controller already closed, ignore
                }
              }
            };
            
            const safeError = (err: Error) => {
              if (!isClosed) {
                isClosed = true;
                try {
                  controller.error(err);
                } catch (error) {
                  // Controller already closed, ignore
                }
              }
            };
            
            nodeStream.on("data", (chunk) => {
              if (!isClosed) {
                try {
                  controller.enqueue(chunk);
                } catch (err) {
                  // Controller closed during enqueue, stop reading
                  nodeStream.destroy();
                  safeClose();
                }
              }
            });
            
            nodeStream.on("end", safeClose);
            nodeStream.on("error", safeError);
          },
          cancel() {
            nodeStream.destroy();
          },
        });
  
        return new Response(webStream, {
          status: 206,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": chunkSize.toString(),
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
  
      // No range → full file
      const nodeStream = createReadStream(filePath);
      const webStream = new ReadableStream({
        start(controller) {
          let isClosed = false;
          
          const safeClose = () => {
            if (!isClosed) {
              isClosed = true;
              try {
                controller.close();
              } catch (err) {
                // Controller already closed, ignore
              }
            }
          };
          
          const safeError = (err: Error) => {
            if (!isClosed) {
              isClosed = true;
              try {
                controller.error(err);
              } catch (error) {
                // Controller already closed, ignore
              }
            }
          };
          
          nodeStream.on("data", (chunk) => {
            if (!isClosed) {
              try {
                controller.enqueue(chunk);
              } catch (err) {
                // Controller closed during enqueue, stop reading
                nodeStream.destroy();
                safeClose();
              }
            }
          });
          
          nodeStream.on("end", safeClose);
          nodeStream.on("error", safeError);
        },
        cancel() {
          nodeStream.destroy();
        },
      });
  
      return new Response(webStream, {
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": fileSize.toString(),
          "Accept-Ranges": "bytes",
        },
      });
    } catch (err) {
      console.error("Protocol error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  });

  windowStateManager = new WindowStateManager();
  videoCacheManager = new VideoCacheManager();
  createWindow();

  // Configure auto-updater (only in production)
  // Per electron-builder docs: https://www.electron.build/auto-update
  // - electron-builder automatically creates app-update.yml in resources folder
  // - Do NOT call setFeedURL - it's handled automatically
  // - Update server info comes from publish config in electron-builder.config.js

  if (!isDev) {
    // Silent background updates: auto-download and install on quit
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  
    app.whenReady().then(() => {
      // Initial check
      autoUpdater.checkForUpdates().catch((error) => {
        console.error("[Auto-Updater] Error checking for updates:", error);
      });
  
      // Hourly checks
      setInterval(() => {
        autoUpdater.checkForUpdates().catch((error) => {
          console.error("[Auto-Updater] Error during scheduled check:", error);
        });
      }, 60 * 60 * 1000);
    });
  
    // Log events for debugging (no UI notifications)
    autoUpdater.on("update-available", (info) => {
      console.log("[Auto-Updater] Update available, downloading in background...", info.version);
    });
  
    autoUpdater.on("update-downloaded", (info) => {
      console.log("[Auto-Updater] Update downloaded, will install on app quit", info.version);
    });
  
    autoUpdater.on("error", (error) => {
      console.error("[Auto-Updater] Error:", error);
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

// Generic window creation helper
const createWindowByType = (windowType: WindowType): void => {
  if (windowType === "projector") {
    createProjectorWindow();
  } else {
    createMonitorWindow();
  }
};

// Generic window management functions
const closeWindowByType = (windowType: WindowType): boolean => {
  const window = getWindowByType(windowType);
  if (window && !window.isDestroyed()) {
    window.close();
    return true;
  }
  return false;
};

const toggleFullscreen = (window: BrowserWindow | null): boolean => {
  if (window && !window.isDestroyed()) {
    const isFullScreen = window.isFullScreen();
    window.setFullScreen(!isFullScreen);
    return !isFullScreen;
  }
  return false;
};

// Generic IPC handlers
ipcMain.handle("open-window", (_event, windowType: WindowType) => {
  createWindowByType(windowType);
  return true;
});

ipcMain.handle("close-window", (_event, windowType: WindowType) => {
  return closeWindowByType(windowType);
});

ipcMain.handle("focus-window", (_event, windowType: WindowType) => {
  const window = getWindowByType(windowType);
  return focusWindow(window);
});

ipcMain.handle("toggle-window-fullscreen", (_event, windowType: WindowType) => {
  const window = getWindowByType(windowType);
  return toggleFullscreen(window);
});

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

// Helper function to get window by type
const getWindowByType = (windowType: WindowType): BrowserWindow | null => {
  return windowType === "projector" ? projectorWindow : monitorWindow;
};

// Helper function to set window by type
const setWindowByType = (windowType: WindowType, window: BrowserWindow | null): void => {
  if (windowType === "projector") {
    projectorWindow = window;
  } else {
    monitorWindow = window;
  }
};

const moveWindowToDisplay = (
  window: BrowserWindow | null,
  windowType: WindowType,
  displayId: number
): boolean => {
  if (!window || window.isDestroyed()) return false;

  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find((d) => d.id === displayId);

  if (!targetDisplay) return false;

  // Move window to display and make it fullscreen
  window.setBounds({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
  });
  
  // Ensure it's fullscreen (in case it was somehow not)
  if (!window.isFullScreen()) {
    window.setFullScreen(true);
  }

  windowStateManager.saveWindowState(windowType, window);
  return true;
};

// Generic IPC handlers
ipcMain.handle("move-window-to-display", (_event, windowType: WindowType, displayId: number) => {
  const window = getWindowByType(windowType);
  return moveWindowToDisplay(window, windowType, displayId);
});

ipcMain.handle("set-display-preference", (_event, windowType: WindowType, displayId: number) => {
  windowStateManager.setDisplayPreference(windowType, displayId);
  return true;
});


ipcMain.handle("get-window-states", () => {
  const projectorState = windowStateManager.getState("projector");
  const monitorState = windowStateManager.getState("monitor");
  
  return {
    projector: projectorState,
    monitor: monitorState,
    projectorOpen: projectorWindow !== null,
    monitorOpen: monitorWindow !== null,
  };
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
  
  // If it's already a URL (http:// or https://), return as-is
  if (localPath.startsWith("http://") || localPath.startsWith("https://")) {
    return localPath;
  }
  
  // Convert file path to video-cache:// protocol URL
  // Extract just the filename from the path
  const filename = localPath.split(/[/\\]/).pop();
  if (filename) {
    return `video-cache://${filename}`;
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

// Route persistence IPC handlers
const getRouteFilePath = (): string => {
  return join(app.getPath("userData"), "last-route.json");
};

ipcMain.handle("save-last-route", (_event, route: string) => {
  try {
    const routeFilePath = getRouteFilePath();
    writeFileSync(routeFilePath, JSON.stringify({ route }, null, 2), "utf-8");
    return true;
  } catch (error) {
    console.error("Error saving last route:", error);
    return false;
  }
});

ipcMain.handle("get-last-route", () => {
  try {
    const routeFilePath = getRouteFilePath();
    if (existsSync(routeFilePath)) {
      const data = readFileSync(routeFilePath, "utf-8");
      const parsed = JSON.parse(data);
      return parsed.route || null;
    }
  } catch (error) {
    console.error("Error loading last route:", error);
  }
  return null;
});

// Upload status IPC handlers
ipcMain.handle("set-upload-in-progress", (_event, inProgress: boolean) => {
  isUploadInProgress = inProgress;
  return true;
});
