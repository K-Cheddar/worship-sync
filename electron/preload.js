const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ws", {
  version: "desktop",
  checkForUpdates: () => ipcRenderer.invoke("ws.checkForUpdates"),
});
