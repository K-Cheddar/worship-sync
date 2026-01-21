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
});

// Expose a flag to indicate we're running in Electron
contextBridge.exposeInMainWorld("__ELECTRON__", true);
