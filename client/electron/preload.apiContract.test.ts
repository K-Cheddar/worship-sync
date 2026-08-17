import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Contract test for the Electron preload privilege boundary.
 * Keeps the renderer-facing API surface stable without booting Electron.
 */
describe("electron preload API contract", () => {
  const preloadSource = readFileSync(join(__dirname, "preload.ts"), "utf8");

  it("exposes the core window and media IPC methods on electronAPI", () => {
    const requiredMethods = [
      "getAppVersion",
      "isElectron",
      "openWindow",
      "closeWindow",
      "focusWindow",
      "getDisplays",
      "getWindowStates",
      "onWindowStateChanged",
      "downloadMedia",
      "getMediaCacheMap",
      "importLocalAsset",
      "getLocalAsset",
      "deleteLocalAsset",
      "openExternalUrl",
      "saveLastRoute",
      "getLastRoute",
    ];

    for (const method of requiredMethods) {
      expect(preloadSource).toContain(`${method}:`);
    }
  });

  it("exposes the Electron runtime flag", () => {
    expect(preloadSource).toContain('exposeInMainWorld("__ELECTRON__", true)');
  });

  it("does not expose raw ipcRenderer to the renderer", () => {
    expect(preloadSource).not.toMatch(
      /exposeInMainWorld\(\s*["']ipcRenderer["']/,
    );
    expect(preloadSource).not.toMatch(/exposeInMainWorld\(\s*["']require["']/);
  });

  it("keeps native file paths inside the preload boundary", () => {
    expect(preloadSource).toContain("webUtils.getPathForFile(file)");
    expect(preloadSource).not.toContain("getPathForFile:");
  });
});
