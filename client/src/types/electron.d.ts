// Re-export WindowType from windowState for use in React code
// The actual type is defined in electron/windowState.ts
import type { ResourcePolicy } from "../../electron/resourceGovernor";
/**
 * Key identifying a display window. The original surfaces keep "projector",
 * "monitor", and "board"; a window opened for a display output uses that
 * output id.
 */
export type WindowType = string;

export type PreparedVideoSourceInfo = {
  source: string;
  sourceUrl: string;
  contentType?: string;
};

export type PreparedVideoMetricValue = {
  status: "available" | "unsupported";
  value?: number;
  reason?: string;
};

export type PreparedVideoMetrics = {
  status:
    | "available"
    | "ipc_unavailable"
    | "renderer_pid_not_matched"
    | "metric_unsupported"
    | "stale";
  timestamp?: number;
  rendererPid?: number;
  matchedPid?: number;
  processType?: string;
  memory: {
    private?: PreparedVideoMetricValue;
    workingSet?: PreparedVideoMetricValue;
  };
  cpu: PreparedVideoMetricValue;
  total?: {
    privateMemory: PreparedVideoMetricValue;
    workingSetMemory: PreparedVideoMetricValue;
    cpu: PreparedVideoMetricValue;
    processCount: number;
  };
  processes?: Array<{
    pid: number;
    processType: string;
    name?: string;
    serviceName?: string;
    labels: string[];
    memory: {
      private?: PreparedVideoMetricValue;
      workingSet?: PreparedVideoMetricValue;
    };
    cpu: PreparedVideoMetricValue;
  }>;
  reason?: string;
};

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

/** A screen or window this computer can capture. Ids are per-session. */
export interface ElectronDesktopCaptureSource {
  id: string;
  name: string;
  thumbnailDataUrl?: string;
}

export interface ElectronLocalAsset {
  /** Native base hash returned only for a staged relink. */
  previousContentHash?: string;
  assetId: string;
  workspaceId?: string;
  kind: "image" | "video" | "audio" | "pdf";
  fileName: string;
  contentType: string;
  contentHash?: string;
  storageMode?: "managed" | "linked";
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
  updatedAt: string;
  url: string;
  savedFileName?: string;
}

export type DesktopVideoInspection = {
  inspectionId: string;
  videoUrl: string;
  title: string;
  thumbnail: string;
  duration: number;
  heights: number[];
  defaultQuality: number | "best";
};

export type DesktopVideoDownloadEvent = {
  jobId: string;
  stage: "preparing" | "downloading" | "processing" | "uploading" | "complete" | "failed" | "cancelled";
  progress: number | null;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  streamId?: string;
  streamLabel?: string;
  error?: string;
  result?: { width: number; height: number; duration: number; size: number };
};

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  isElectron: () => Promise<boolean>;
  isDev: () => Promise<boolean>;
  openExternalUrl: (
    url: string,
    options?: { allowArbitraryHttps?: boolean },
  ) => Promise<boolean>;
  fetchGeniusLyrics: (url: string) => Promise<{
    ok: boolean;
    status: number;
    lyrics?: string;
    html?: string;
  }>;
  searchGeniusLyrics: (query: {
    trackName: string;
    artistName?: string;
    albumName?: string;
  }) => Promise<unknown[]>;

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
  onWindowStateChanged: (callback: () => void) => () => void;
  checkForUpdates: () => Promise<{
    available: boolean;
    updateInfo?: unknown;
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
  ensureMediaCached: (urls: string[]) => Promise<{
    requested: number;
    cacheable: number;
    downloaded: number;
    failed: number;
    cacheMap: Record<string, string>;
  }>;
  getMediaCacheMap: () => Promise<Record<string, string>>;
  getPreparedVideoSources?: () => Promise<PreparedVideoSourceInfo[]>;
  getLocalMediaPath: (url: string) => Promise<string | null>;
  cleanupUnusedMedia: (usedUrls: string[]) => Promise<void>;
  syncMediaCache: (
    mediaUrls: string[],
  ) => Promise<{ downloaded: number; cleaned: number }>;
  /** Timestamped app-process metrics, sampled once in main while subscribed. */
  getPreparedVideoMetrics?: () => Promise<PreparedVideoMetrics>;
  subscribePreparedVideoMetrics?: (
    callback: (metrics: PreparedVideoMetrics) => void,
  ) => () => void;
  getResourceGovernorPolicy?: () => Promise<ResourcePolicy>;
  subscribeResourceGovernorPolicy?: (
    callback: (policy: ResourcePolicy) => void,
  ) => () => void;

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
  importLocalAssetBytes: (
    data: ArrayBuffer,
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
  linkLocalVideoFile: (workspaceId: string) => Promise<ElectronLocalAsset | undefined>;
  notifyLocalVideoAssetChanged: (assetId: string, contentHash: string) => Promise<boolean>;
  onLocalVideoAssetChanged: (callback: (assetId: string) => void) => () => void;
  getLocalVideoRelinkStatus: (assetId: string, candidateId: string) => Promise<{ status: "pending" | "committed" | "superseded" | "missing"; asset?: ElectronLocalAsset }>;
  commitRelinkLocalVideoFile: (assetId: string, candidateId: string) => Promise<ElectronLocalAsset>;
  relinkLocalVideoFile: (assetId: string) => Promise<ElectronLocalAsset | undefined>;

  // Native desktop video download. Job output paths remain in the main process.
  isVideoDownloaderAvailable: () => Promise<boolean>;
  inspectVideoUrl: (url: string) => Promise<DesktopVideoInspection>;
  startVideoDownload: (input: {
    jobId: string;
    inspectionId: string;
    quality: number | "best";
    destinationDirectoryId?: string;
  }) => Promise<{ jobId: string }>;
  cancelVideoDownload: (jobId: string) => Promise<boolean>;
  importDownloadedVideo: (input: {
    jobId: string;
    workspaceId: string;
    width: number;
    height: number;
  }) => Promise<ElectronLocalAsset>;
  uploadDownloadedVideoToMux: (jobId: string, url: string) => Promise<void>;
  uploadLocalVideoAssetToMux: (input: {
    jobId: string;
    assetId: string;
    url: string;
  }) => Promise<void>;
  cleanupVideoDownload: (jobId: string) => Promise<boolean>;
  getVideoDownloadPreferences: () => Promise<{
    saveOutsideWorshipSync: boolean;
    uploadToCloud: boolean;
    hasDestinationDirectory: boolean;
    destinationDirectoryAvailable: boolean;
    destinationDirectoryId?: string;
    destinationDirectoryDisplay?: string;
  }>;
  updateVideoDownloadPreferences: (preferences: {
    saveOutsideWorshipSync?: boolean;
    uploadToCloud?: boolean;
  }) => Promise<{
    saveOutsideWorshipSync: boolean;
    uploadToCloud: boolean;
    hasDestinationDirectory: boolean;
    destinationDirectoryAvailable: boolean;
    destinationDirectoryId?: string;
    destinationDirectoryDisplay?: string;
  }>;
  chooseVideoDownloadDirectory: () => Promise<{
    hasDestinationDirectory: boolean;
    destinationDirectoryAvailable: boolean;
    destinationDirectoryId?: string;
    destinationDirectoryDisplay?: string;
  } | undefined>;
  saveDownloadedVideoExternally: (input: {
    jobId: string;
    workspaceId: string;
    displayName: string;
    width: number;
    height: number;
  }) => Promise<ElectronLocalAsset>;
  onVideoDownloadProgress: (
    callback: (event: DesktopVideoDownloadEvent) => void,
  ) => () => void;

  // Screen and window capture sources on this computer
  getDesktopCaptureSources: (options?: {
    withThumbnails?: boolean;
  }) => Promise<ElectronDesktopCaptureSource[]>;

  // Route persistence
  saveLastRoute: (route: string) => Promise<boolean>;
  getLastRoute: () => Promise<string | null>;

  // Upload status
  setUploadInProgress: (inProgress: boolean) => Promise<boolean>;
  /** 0–1 normalized progress, or `null` to clear the taskbar / dock indicator. */
  setTaskbarUploadProgress: (progress: number | null) => Promise<boolean>;
  setChatTaskbarUnreadState?: (state: {
    scope: { churchId: string; actorId: string } | null;
    unreadCount: number;
    revision: number;
  }) => Promise<boolean>;
  requestChatTaskbarAttention?: (scope: {
    churchId: string;
    actorId: string;
  }) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __ELECTRON__?: boolean;
  }
}

export {};
