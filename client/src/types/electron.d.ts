// Re-export WindowType from windowState for use in React code
// The actual type is defined in electron/windowState.ts
export type WindowType = "projector" | "monitor";

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
  width: number;
  height: number;
  isFullScreen: boolean;
}

export interface WindowStatesInfo {
  projector: WindowState;
  monitor: WindowState;
  projectorOpen: boolean;
  monitorOpen: boolean;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  isElectron: () => Promise<boolean>;
  isDev: () => Promise<boolean>;
  
  // Window management - all generic handlers
  openWindow: (windowType: WindowType) => Promise<boolean>;
  closeWindow: (windowType: WindowType) => Promise<boolean>;
  focusWindow: (windowType: WindowType) => Promise<boolean>;
  toggleWindowFullscreen: (windowType: WindowType) => Promise<boolean>;
  moveWindowToDisplay: (windowType: WindowType, displayId: number) => Promise<boolean>;
  setDisplayPreference: (windowType: WindowType, displayId: number) => Promise<boolean>;
  getDisplays: () => Promise<Display[]>;
  getWindowStates: () => Promise<WindowStatesInfo>;
  
  // Media cache
  downloadMedia: (url: string) => Promise<string | null>;
  getLocalMediaPath: (url: string) => Promise<string | null>;
  cleanupUnusedMedia: (usedUrls: string[]) => Promise<void>;
  syncMediaCache: (mediaUrls: string[]) => Promise<{ downloaded: number; cleaned: number }>;
  
  // Route persistence
  saveLastRoute: (route: string) => Promise<boolean>;
  getLastRoute: () => Promise<string | null>;
  
  // Upload status
  setUploadInProgress: (inProgress: boolean) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __ELECTRON__?: boolean;
  }
}

export {};
