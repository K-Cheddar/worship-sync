/**
 * Utility functions for GitHub Releases
 */

// Get repository info from environment or use defaults
const GITHUB_REPO_OWNER = import.meta.env.VITE_GITHUB_REPO_OWNER || "K-Cheddar";
const GITHUB_REPO_NAME = import.meta.env.VITE_GITHUB_REPO_NAME || "worship-sync";

/**
 * Get the latest release download URL for Windows
 * Note: GitHub redirects to the actual file, so we use the releases/latest page
 */
export const getWindowsDownloadUrl = (): string => {
  return getLatestReleaseUrl();
};

/**
 * Get the latest release page URL
 */
export const getLatestReleaseUrl = (): string => {
  return `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;
};

/**
 * Get download URL for a specific platform
 */
export const getDownloadUrl = (platform: "windows" | "mac" | "linux"): string => {
  // GitHub releases/latest redirects to the latest release page
  // Users can download from there
  return getLatestReleaseUrl();
};
