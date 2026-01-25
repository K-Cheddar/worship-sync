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
  
  // Window management
  openProjectorWindow: () => Promise<boolean>;
  openMonitorWindow: () => Promise<boolean>;
  closeProjectorWindow: () => Promise<boolean>;
  closeMonitorWindow: () => Promise<boolean>;
  toggleProjectorFullscreen: () => Promise<boolean>;
  toggleMonitorFullscreen: () => Promise<boolean>;
  focusProjectorWindow: () => Promise<boolean>;
  focusMonitorWindow: () => Promise<boolean>;
  getDisplays: () => Promise<Display[]>;
  moveProjectorToDisplay: (displayId: number) => Promise<boolean>;
  moveMonitorToDisplay: (displayId: number) => Promise<boolean>;
  getWindowStates: () => Promise<WindowStatesInfo>;
  
  // Video cache
  downloadVideo: (url: string) => Promise<string | null>;
  getLocalVideoPath: (url: string) => Promise<string | null>;
  cleanupUnusedVideos: (usedUrls: string[]) => Promise<void>;
  syncVideoCache: (videoUrls: string[]) => Promise<{ downloaded: number; cleaned: number }>;
  
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
