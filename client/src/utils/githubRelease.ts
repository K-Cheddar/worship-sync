/**
 * Utility functions for GitHub Releases
 */

import { isElectron } from "./environment";

// Get repository info from environment or use defaults
const GITHUB_REPO_OWNER = import.meta.env.VITE_GITHUB_REPO_OWNER || "K-Cheddar";
const GITHUB_REPO_NAME = import.meta.env.VITE_GITHUB_REPO_NAME || "worship-sync";

const latestReleaseApiUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;

type GitHubReleaseLatest = {
  assets?: Array<{ name: string; browser_download_url: string }>;
};

/**
 * Resolve the Windows NSIS installer URL for the latest GitHub release.
 * Uses the public API so the link stays correct as versions change (unlike a
 * fixed `releases/latest/download/<filename>` URL, which requires a stable asset name).
 * Falls back to null on failure; callers should use {@link getLatestReleaseUrl} as a fallback href.
 */
export const fetchLatestWindowsInstallerUrl = async (): Promise<string | null> => {
  if (isElectron()) {
    return null;
  }
  try {
    const res = await fetch(latestReleaseApiUrl, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GitHubReleaseLatest;
    const assets = data.assets ?? [];
    const setupExe = assets.find((a) =>
      /^WorshipSync-Setup-.+\.exe$/i.test(a.name),
    );
    const anyExe = assets.find((a) => a.name.endsWith(".exe"));
    const chosen = setupExe ?? anyExe;
    return chosen?.browser_download_url ?? null;
  } catch {
    return null;
  }
};

/**
 * Get the latest release download URL for Windows
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
  return getLatestReleaseUrl();
};
