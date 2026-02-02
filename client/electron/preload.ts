import { contextBridge, ipcRenderer } from "electron";
import type { WindowType } from "./windowState";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  isElectron: () => ipcRenderer.invoke("is-electron"),
  isDev: () => ipcRenderer.invoke("is-dev"),
  
  // Window management - all generic handlers
  openWindow: (windowType: WindowType) => ipcRenderer.invoke("open-window", windowType),
  closeWindow: (windowType: WindowType) => ipcRenderer.invoke("close-window", windowType),
  focusWindow: (windowType: WindowType) => ipcRenderer.invoke("focus-window", windowType),
  toggleWindowFullscreen: (windowType: WindowType) => ipcRenderer.invoke("toggle-window-fullscreen", windowType),
  moveWindowToDisplay: (windowType: WindowType, displayId: number) => ipcRenderer.invoke("move-window-to-display", windowType, displayId),
  setDisplayPreference: (windowType: WindowType, displayId: number) => ipcRenderer.invoke("set-display-preference", windowType, displayId),
  getDisplays: () => ipcRenderer.invoke("get-displays"),
  getWindowStates: () => ipcRenderer.invoke("get-window-states"),
  
  // Event listeners
  onWindowStateChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("window-state-changed", listener);
    return () => ipcRenderer.removeListener("window-state-changed", listener);
  },

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("quit-and-install"),
  onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: { version: string; releaseDate?: string }) => callback(info);
    ipcRenderer.on("update-available", listener);
    return () => ipcRenderer.removeListener("update-available", listener);
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("update-not-available", listener);
    return () => ipcRenderer.removeListener("update-not-available", listener);
  },
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, info: { version: string }) => callback(info);
    ipcRenderer.on("update-downloaded", listener);
    return () => ipcRenderer.removeListener("update-downloaded", listener);
  },
  onUpdateDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, progress: { percent: number; transferred: number; total: number }) => callback(progress);
    ipcRenderer.on("update-download-progress", listener);
    return () => ipcRenderer.removeListener("update-download-progress", listener);
  },
  onUpdateError: (callback: (error: { message: string }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, error: { message: string }) => callback(error);
    ipcRenderer.on("update-error", listener);
    return () => ipcRenderer.removeListener("update-error", listener);
  },

  // Video cache
  downloadVideo: (url: string) => ipcRenderer.invoke("download-video", url),
  getLocalVideoPath: (url: string) => ipcRenderer.invoke("get-local-video-path", url),
  cleanupUnusedVideos: (usedUrls: string[]) => ipcRenderer.invoke("cleanup-unused-videos", usedUrls),
  syncVideoCache: (videoUrls: string[]) => ipcRenderer.invoke("sync-video-cache", videoUrls),
  
  // Route persistence
  saveLastRoute: (route: string) => ipcRenderer.invoke("save-last-route", route),
  getLastRoute: () => ipcRenderer.invoke("get-last-route"),
  
  // Upload status
  setUploadInProgress: (inProgress: boolean) => ipcRenderer.invoke("set-upload-in-progress", inProgress),
});

// Expose a flag to indicate we're running in Electron
contextBridge.exposeInMainWorld("__ELECTRON__", true);
