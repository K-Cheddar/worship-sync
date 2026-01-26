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

type WindowType = "projector" | "monitor";

interface WindowState {
  displayId?: number;
  x?: number;
  y?: number;
  width: number;
  height: number;
  isFullScreen: boolean;
}

interface WindowStatesInfo {
  projector: WindowState;
  monitor: WindowState;
  projectorOpen: boolean;
  monitorOpen: boolean;
}

interface ElectronAPI {
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
  
  // Event listeners
  onWindowStateChanged: (callback: () => void) => () => void;
  
  // Auto-updater
  checkForUpdates: () => Promise<{ available: boolean; updateInfo?: any; error?: string; message?: string }>;
  downloadUpdate: () => Promise<boolean>;
  installUpdate: () => Promise<void>;
  
  // Update event listeners
  onUpdateAvailable?: (callback: (info: { version: string; releaseDate?: string }) => void) => () => void;
  onUpdateDownloaded?: (callback: (info: { version: string; releaseDate?: string }) => void) => () => void;
  onUpdateDownloadProgress?: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void;
  onUpdateError?: (callback: (error: { message: string }) => void) => () => void;
  
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

interface Window {
  electronAPI?: ElectronAPI;
  __ELECTRON__?: boolean;
}