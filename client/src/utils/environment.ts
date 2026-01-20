/**
 * Environment detection utilities
 * Determines if the app is running in Electron or web browser
 */

// Type definitions for Electron API exposed via preload
declare global {
  interface Window {
    electronAPI?: {
      getAppVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
      isElectron: () => Promise<boolean>;
      isDev: () => Promise<boolean>;
    };
    __ELECTRON__?: boolean;
  }
}

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
 * Get the API base path based on the environment
 * In Electron, we'll use the production server or localhost
 * In web, we'll use the environment variable
 */
export const getApiBasePath = (): string => {
  if (isElectron()) {
    // In Electron, detect if we're in development or production
    // In development, the server runs on HTTPS at local.worshipsync.net:5000
    // In production, it runs on HTTP at localhost:5000
    // Check if we're loading from file:// (production) or https:// (dev server)
    // Also check via Electron API if available
    const isDev = window.location.protocol === "https:" || import.meta.env.DEV;
    
    if (isDev) {
      // Development: use HTTPS server
      return import.meta.env.VITE_ELECTRON_API_URL || "https://local.worshipsync.net:5000/";
    } else {
      // Production: use HTTP server
      return import.meta.env.VITE_ELECTRON_API_URL || "http://localhost:5000/";
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
