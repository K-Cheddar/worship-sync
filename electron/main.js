import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import electronUpdater from "electron-updater";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

function resolveClientPath() {
  const devPath = path.join(__dirname, "..", "client", "build", "index.html");
  const packagedAsarPath = path.join(
    process.resourcesPath || "",
    "app.asar",
    "client",
    "build",
    "index.html"
  );
  const packagedDirPath = path.join(
    process.resourcesPath || "",
    "app",
    "client",
    "build",
    "index.html"
  );
  if (fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(packagedAsarPath)) return packagedAsarPath;
  if (fs.existsSync(packagedDirPath)) return packagedDirPath;
  return devPath;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false, // Allow self-signed certificates
    },
    show: false,
  });

  // Set Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob: https:; " +
              "connect-src 'self' https://local.worshipsync.net:5000 https:; " +
              "font-src 'self' data:; " +
              "object-src 'none'; " +
              "base-uri 'self';",
          ],
        },
      });
    }
  );

  const clientPath = resolveClientPath();
  await mainWindow.loadFile(clientPath);
  mainWindow.show();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Configure auto-updates
  try {
    electronUpdater.autoUpdater.autoDownload = true;
    electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
    await electronUpdater.autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    console.error("Auto-update check failed", e);
  }
}

app.on("ready", async () => {
  // Override requests to use local.worshipsync.net
  const defaultSession = session.defaultSession;

  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.includes("localhost:5000")) {
      const newUrl = details.url.replace(
        "localhost:5000",
        "local.worshipsync.net:5000"
      );
      callback({ redirectURL: newUrl });
    } else {
      callback({});
    }
  });

  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  // No server to kill
});

app.on("activate", async () => {
  if (mainWindow === null) {
    await createWindow();
  }
});

// Manual update trigger from renderer
ipcMain.handle("ws.checkForUpdates", async () => {
  const result = await electronUpdater.autoUpdater.checkForUpdates();
  return {
    updateInfo: result?.updateInfo,
  };
});

electronUpdater.autoUpdater.on("update-downloaded", () => {
  // Install on next quit; users will get a notification from OS after relaunch
});

// Periodic update checks every 6 hours
setInterval(() => {
  electronUpdater.autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}, 6 * 60 * 60 * 1000);
