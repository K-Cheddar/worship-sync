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
}

interface Window {
  electronAPI?: ElectronAPI;
  __ELECTRON__?: boolean;
}