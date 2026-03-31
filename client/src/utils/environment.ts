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
      (window.electronAPI !== undefined && window.electronAPI.isElectron !== undefined))
  );
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
      return import.meta.env.VITE_ELECTRON_API_URL || "https://local.worshipsync.net:5000/";
    } else {
      // Production: use production API server (packaged app loads from file://)
      return import.meta.env.VITE_ELECTRON_API_URL || "https://www.worshipsync.net/";
    }
  }
  
  // In web, use the configured base path or default to relative path
  return import.meta.env.VITE_API_BASE_PATH || "/";
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
