import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  isElectron: () => ipcRenderer.invoke("is-electron"),
  isDev: () => ipcRenderer.invoke("is-dev"),
  
  // Window management
  openProjectorWindow: () => ipcRenderer.invoke("open-projector-window"),
  openMonitorWindow: () => ipcRenderer.invoke("open-monitor-window"),
  closeProjectorWindow: () => ipcRenderer.invoke("close-projector-window"),
  closeMonitorWindow: () => ipcRenderer.invoke("close-monitor-window"),
  toggleProjectorFullscreen: () => ipcRenderer.invoke("toggle-projector-fullscreen"),
  toggleMonitorFullscreen: () => ipcRenderer.invoke("toggle-monitor-fullscreen"),
  focusProjectorWindow: () => ipcRenderer.invoke("focus-projector-window"),
  focusMonitorWindow: () => ipcRenderer.invoke("focus-monitor-window"),
  getDisplays: () => ipcRenderer.invoke("get-displays"),
  moveProjectorToDisplay: (displayId: number) => ipcRenderer.invoke("move-projector-to-display", displayId),
  moveMonitorToDisplay: (displayId: number) => ipcRenderer.invoke("move-monitor-to-display", displayId),
  getWindowStates: () => ipcRenderer.invoke("get-window-states"),
  
  // Event listeners
  onWindowStateChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("window-state-changed", listener);
    return () => ipcRenderer.removeListener("window-state-changed", listener);
  },
  
  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  
  // Update event listeners
  onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string }) => void) => {
    const listener = (_event: any, info: { version: string; releaseDate?: string }) => callback(info);
    ipcRenderer.on("update-available", listener);
    return () => ipcRenderer.removeListener("update-available", listener);
  },
  onUpdateDownloaded: (callback: (info: { version: string; releaseDate?: string }) => void) => {
    const listener = (_event: any, info: { version: string; releaseDate?: string }) => callback(info);
    ipcRenderer.on("update-downloaded", listener);
    return () => ipcRenderer.removeListener("update-downloaded", listener);
  },
  onUpdateDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
    const listener = (_event: any, progress: { percent: number; transferred: number; total: number }) => callback(progress);
    ipcRenderer.on("update-download-progress", listener);
    return () => ipcRenderer.removeListener("update-download-progress", listener);
  },
  onUpdateError: (callback: (error: { message: string }) => void) => {
    const listener = (_event: any, error: { message: string }) => callback(error);
    ipcRenderer.on("update-error", listener);
    return () => ipcRenderer.removeListener("update-error", listener);
  },
  
  // Video cache
  downloadVideo: (url: string) => ipcRenderer.invoke("download-video", url),
  getLocalVideoPath: (url: string) => ipcRenderer.invoke("get-local-video-path", url),
  cleanupUnusedVideos: (usedUrls: string[]) => ipcRenderer.invoke("cleanup-unused-videos", usedUrls),
  syncVideoCache: (videoUrls: string[]) => ipcRenderer.invoke("sync-video-cache", videoUrls),
});

// Expose a flag to indicate we're running in Electron
contextBridge.exposeInMainWorld("__ELECTRON__", true);
