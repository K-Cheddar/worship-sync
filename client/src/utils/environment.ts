/**
 * Environment detection utilities
 * Determines if the app is running in Electron or web browser
 */

/**
 * Check if the app is running in Electron
 */
export const isElectron = (): boolean => {
  return (
    typeof window !== "undefined" &&
    (window.__ELECTRON__ === true ||
      (window.electronAPI !== undefined &&
        window.electronAPI.isElectron !== undefined))
  );
};

/** Packaged app loads the renderer from `file://`; dev loads from HTTPS. */
export const isPackagedElectronRenderer = (): boolean =>
  typeof window !== "undefined" &&
  isElectron() &&
  window.location.protocol === "file:";

/** Reload open projector/monitor/board windows (Electron only). Use after auth changes. */
export const reloadElectronDisplayWindows = (): void => {
  if (typeof window === "undefined" || !isElectron()) return;
  const api = window.electronAPI;
  if (!api?.refreshDisplayWindows) return;
  void api.refreshDisplayWindows().catch(() => {
    // ignore — non-fatal if main process is unavailable
  });
};

/**
 * True when running in a normal browser on Windows (not Electron).
 * Used to show Windows desktop installer actions on the web home page.
 */
export const isWindowsBrowser = (): boolean => {
  if (typeof window === "undefined" || isElectron()) {
    return false;
  }
  const ua = navigator.userAgent;
  const uaDataPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  return (
    /Windows/i.test(navigator.platform) ||
    /Windows/i.test(ua) ||
    uaDataPlatform === "Windows"
  );
};

/**
 * True when running in a normal browser on macOS (not Electron).
 * Used to show macOS desktop installer actions on the web home page.
 */
export const isMacBrowser = (): boolean => {
  if (typeof window === "undefined" || isElectron()) {
    return false;
  }
  if (isWindowsBrowser()) {
    return false;
  }
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return false;
  }
  const uaDataPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  return (
    /Mac/i.test(navigator.platform) ||
    uaDataPlatform === "macOS" ||
    /Mac OS X|Macintosh/i.test(ua)
  );
};

/**
 * True when running in a normal browser on desktop Linux (not Electron).
 * Android browsers often include "Linux" in the user agent; those are excluded.
 * Used to show Linux desktop installer actions on the web home page.
 */
export const isLinuxBrowser = (): boolean => {
  if (typeof window === "undefined" || isElectron()) {
    return false;
  }
  if (isWindowsBrowser() || isMacBrowser()) {
    return false;
  }
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    return false;
  }
  const uaDataPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  if (uaDataPlatform === "Linux") {
    return true;
  }
  return /Linux/i.test(navigator.platform) || /\bLinux\b/i.test(ua);
};

/**
 * Get the API base path based on the environment
 * In Electron, we'll use the production server or localhost
 * In web, we'll use the environment variable
 */
export const getApiBasePath = (): string => {
  if (isElectron()) {
    // In Electron, check if we're in production
    // file:// protocol means we're in a packaged app (production)
    // https:// protocol means we're loading from dev server (development)
    const isDev = window.location.protocol === "https:";

    if (isDev) {
      // Development: use local HTTPS server
      return (
        import.meta.env.VITE_ELECTRON_API_URL ||
        "https://local.worshipsync.net:5000/"
      );
    } else {
      // Production: use production API server (packaged app loads from file://)
      return (
        import.meta.env.VITE_ELECTRON_API_URL || "https://www.worshipsync.net/"
      );
    }
  }

  // In web, use the configured base path or default to relative path
  return import.meta.env.VITE_API_BASE_PATH || "/";
};

const shareablePrefixFromHttpApiBase = (apiBase: string): string => {
  const parsed = new URL(apiBase);
  const path = parsed.pathname.replace(/\/+$/, "");
  const normalizedPath = path === "" || path === "/" ? "" : path;
  return `${parsed.origin}${normalizedPath}${parsed.search}`;
};

/**
 * Origin + path + query for the **web** app, used before the `#` in hash routes.
 * Packaged Electron uses `file://` here; share/copy must use the public HTTPS origin instead
 * (same host as {@link getApiBasePath} in production builds).
 */
export const getShareableHashRouterUrlPrefix = (): string => {
  if (typeof window === "undefined") {
    return "";
  }
  if (isPackagedElectronRenderer()) {
    try {
      return shareablePrefixFromHttpApiBase(getApiBasePath());
    } catch {
      return "https://www.worshipsync.net";
    }
  }
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
};

/** Full URL for a hash-router path (e.g. `/boards/x`), safe to copy from Electron. */
export const buildShareableHashRouterUrl = (hashRoute: string): string => {
  const prefix = getShareableHashRouterUrlPrefix();
  const trimmed = hashRoute.replace(/^#/, "");
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${prefix}#${path}`;
};

/**
 * Get the development mode status (async, for Electron)
 */
export const getIsDev = async (): Promise<boolean> => {
  if (isElectron() && window.electronAPI) {
    try {
      return await window.electronAPI.isDev();
    } catch (error) {
      console.error("Error getting dev mode:", error);
      // Fallback to protocol check
      return window.location.protocol === "https:";
    }
  }
  return import.meta.env.DEV || false;
};

/**
 * Get the platform (if in Electron)
 */
export const getPlatform = async (): Promise<string | null> => {
  if (isElectron() && window.electronAPI) {
    try {
      return await window.electronAPI.getPlatform();
    } catch (error) {
      console.error("Error getting platform:", error);
      return null;
    }
  }
  return null;
};

/**
 * Get the app version (if in Electron)
 */
export const getAppVersion = async (): Promise<string | null> => {
  if (isElectron() && window.electronAPI) {
    try {
      return await window.electronAPI.getAppVersion();
    } catch (error) {
      console.error("Error getting app version:", error);
      return null;
    }
  }
  return null;
};
