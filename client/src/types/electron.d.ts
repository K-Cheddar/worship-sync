// Re-export WindowType from windowState for use in React code
// The actual type is defined in electron/windowState.ts
/**
 * Key identifying a display window. The original surfaces keep "projector",
 * "monitor", and "board"; a window opened for a display output uses that
 * output id.
 */
export type WindowType = string;

export interface Display {
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

export interface WindowState {
  displayId?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isFullScreen?: boolean;
}

export interface WindowStatesInfo {
  /** Per-window state keyed by window key, each carrying whether it is open. */
  displays: Record<string, WindowState & { isOpen: boolean }>;
}

export interface ElectronLocalAsset {
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

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  isElectron: () => Promise<boolean>;
  isDev: () => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<boolean>;

  // Window management - all generic handlers
  /** `surface` names the render profile when opening an output window. */
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
   * generation floor so any in-flight {@link identifyDisplay} is rejected.
   */
  cancelIdentifyDisplay: (generation: number) => Promise<boolean>;
  getWindowStates: (windowKeys?: string[]) => Promise<WindowStatesInfo>;
  /** Reload open projector/monitor/board windows (e.g. after sign-in). */
  refreshDisplayWindows: () => Promise<number>;
  onDesktopAuthCallback: (
    callback: (payload: { desktopAuthId: string }) => void,
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
  /** 0–1 normalized progress, or `null` to clear the taskbar / dock indicator. */
  setTaskbarUploadProgress: (progress: number | null) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __ELECTRON__?: boolean;
  }
}

export {};
