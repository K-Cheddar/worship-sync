declare module "*.svg" {
  import * as React from "react";

  const ReactComponent: React.FunctionComponent<
    React.SVGProps<SVGSVGElement> & { title?: string }
  >;

  export default ReactComponent;
}

// Electron API Types
interface Display {
  id: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;
  rotation: number;
  internal: boolean;
  label?: string;
}

/** Window key: the original surfaces, or a display output id. */
type WindowType = string;

interface WindowState {
  displayId?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isFullScreen?: boolean;
}

interface WindowStatesInfo {
  /** Per-window state keyed by window key, each carrying whether it is open. */
  displays: Record<string, WindowState & { isOpen: boolean }>;
}

interface ElectronLocalAsset {
  assetId: string;
  workspaceId?: string;
  kind: "image" | "video" | "audio" | "pdf";
  fileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
  updatedAt: string;
  url: string;
}

interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  isElectron: () => Promise<boolean>;
  isDev: () => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<boolean>;

  // Window management - all generic handlers
  openWindow: (
    windowType: WindowType,
    surface?: "projector" | "monitor" | "stream",
  ) => Promise<boolean>;
  closeWindow: (windowType: WindowType) => Promise<boolean>;
  focusWindow: (windowType: WindowType) => Promise<boolean>;
  toggleWindowFullscreen: (windowType: WindowType) => Promise<boolean>;
  moveWindowToDisplay: (
    windowType: WindowType,
    displayId: number,
  ) => Promise<boolean>;
  setDisplayPreference: (
    windowType: WindowType,
    displayId: number,
  ) => Promise<boolean>;
  getDisplays: () => Promise<Display[]>;
  /**
   * Flash a click-through "identify" glow on the given display (e.g. on menu hover).
   * `generation` is the menu-session token used to reject stale shows after close.
   */
  identifyDisplay: (displayId: number, generation: number) => Promise<boolean>;
  /** Flash the identify glow on the display "Last Used Display" would open this window onto. */
  identifyDisplayForWindow: (
    windowType: WindowType,
    generation: number,
  ) => Promise<boolean>;
  /** Soft, debounced hide of the identify glow (e.g. on row leave). */
  hideIdentifyDisplay: () => Promise<boolean>;
  /**
   * Authoritative hide on menu close/unmount: hides immediately and raises the
   * generation floor so any in-flight identifyDisplay is rejected.
   */
  cancelIdentifyDisplay: (generation: number) => Promise<boolean>;
  getWindowStates: (windowKeys?: string[]) => Promise<WindowStatesInfo>;
  /** Reload open projector/monitor/board windows (e.g. after sign-in). */
  refreshDisplayWindows: () => Promise<number>;
  onDesktopAuthCallback: (
    callback: (payload: { desktopAuthId: string }) => void,
  ) => () => void;

  // Event listeners
  onWindowStateChanged: (callback: () => void) => () => void;

  // Auto-updater
  checkForUpdates: () => Promise<{
    available: boolean;
    updateInfo?: any;
    error?: string;
    message?: string;
  }>;
  getDesktopUpdateCapabilities: () => Promise<{
    autoUpdate: boolean;
    manualReleaseDownload: boolean;
  }>;
  openDesktopReleaseDownload: () => Promise<{ ok: boolean; error?: string }>;
  installUpdate: () => Promise<
    { ok: true } | { ok: false; reason?: string; error?: string }
  >;

  // Update event listeners
  onUpdateAvailable?: (
    callback: (info: { version: string; releaseDate?: string }) => void,
  ) => () => void;
  onUpdateNotAvailable?: (callback: () => void) => () => void;
  onUpdateDownloaded?: (
    callback: (info: { version: string; releaseDate?: string }) => void,
  ) => () => void;
  onUpdateDownloadProgress?: (
    callback: (progress: {
      percent: number;
      transferred: number;
      total: number;
    }) => void,
  ) => () => void;
  onUpdateError?: (
    callback: (error: { message: string }) => void,
  ) => () => void;

  // Media cache
  downloadMedia: (url: string) => Promise<string | null>;
  getMediaCacheMap: () => Promise<Record<string, string>>;
  getLocalMediaPath: (url: string) => Promise<string | null>;
  cleanupUnusedMedia: (usedUrls: string[]) => Promise<void>;
  syncMediaCache: (
    mediaUrls: string[],
  ) => Promise<{ downloaded: number; cleaned: number }>;

  // App-managed local assets
  importLocalAsset: (
    file: File,
    metadata: {
      assetId: string;
      workspaceId?: string;
      kind: "image" | "video" | "audio" | "pdf";
      fileName: string;
      contentType: string;
      width?: number;
      height?: number;
    },
  ) => Promise<ElectronLocalAsset>;
  getLocalAsset: (assetId: string) => Promise<ElectronLocalAsset | undefined>;
  deleteLocalAsset: (assetId: string) => Promise<boolean>;

  // Route persistence
  saveLastRoute: (route: string) => Promise<boolean>;
  getLastRoute: () => Promise<string | null>;

  // Upload status
  setUploadInProgress: (inProgress: boolean) => Promise<boolean>;
  setTaskbarUploadProgress: (progress: number | null) => Promise<boolean>;
}

interface ObsStudioAPI {
  setCurrentScene?: (sceneName: string) => void;
  getCurrentScene?: (callback: (scene: { name?: string }) => void) => void;
}

interface Window {
  electronAPI?: ElectronAPI;
  __ELECTRON__?: boolean;
  obsstudio?: ObsStudioAPI;
}
