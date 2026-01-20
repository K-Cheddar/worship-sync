import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  isElectron: () => ipcRenderer.invoke("is-electron"),
  isDev: () => ipcRenderer.invoke("is-dev"),
});

// Expose a flag to indicate we're running in Electron
contextBridge.exposeInMainWorld("__ELECTRON__", true);
