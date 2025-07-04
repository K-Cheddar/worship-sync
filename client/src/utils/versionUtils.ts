// localStorage keys
export const VERSION_STORAGE_KEY = "worshipSync_currentVersion";
export const VERSION_UPDATE_DISMISSED_KEY =
  "worshipSync_versionUpdateDismissed";
export const CHANGELOG_CACHE_KEY = "worshipSync_changelogCache";

// Function to fetch and parse changelog for versions between current and new version
export const getChangelogForVersion = async (
  newVersion: string,
  currentVersion?: string
): Promise<string | null> => {
  try {
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_PATH}api/changelog`
    );
    if (!response.ok) {
      throw new Error("Failed to fetch changelog");
    }

    const changelogContent = await response.text();

    // Parse the changelog to find all versions between current and new
    const lines = changelogContent.split("\n");
    let inRelevantSection = false;
    let changelogSections: string[] = [];
    let currentSection: string[] = [];

    for (const line of lines) {
      // Check if this is a version header (supports both # and ##)
      if (line.startsWith("# [") || line.startsWith("## [")) {
        // If we were collecting a section, save it
        if (inRelevantSection && currentSection.length > 0) {
          changelogSections.push(currentSection.join("\n"));
          currentSection = [];
        }

        // Extract version from header (e.g., "# [1.5.0]" -> "1.5.0")
        const versionMatch = line.match(/^#+\s*\[([^\]]+)\]/);
        if (versionMatch) {
          const version = versionMatch[1];

          // Check if this version is newer than current and not newer than new version
          if (
            currentVersion &&
            isNewerVersion(version, currentVersion) &&
            !isNewerVersion(version, newVersion)
          ) {
            inRelevantSection = true;
            currentSection.push(line);
          } else if (version === newVersion) {
            // Include the target version itself
            inRelevantSection = true;
            currentSection.push(line);
          } else if (inRelevantSection) {
            // We've passed all relevant versions, stop collecting
            break;
          }
        }
        continue;
      }

      // If we're in a relevant version section, collect lines
      if (inRelevantSection) {
        currentSection.push(line);
      }
    }

    // Don't forget the last section
    if (inRelevantSection && currentSection.length > 0) {
      changelogSections.push(currentSection.join("\n"));
    }

    if (changelogSections.length > 0) {
      return changelogSections.join("\n\n").trim();
    }

    return null;
  } catch (error) {
    console.error("Error fetching changelog:", error);
    return null;
  }
};

// Helper function to check if a version is newer
export const isNewerVersion = (
  newVersion: string,
  currentVersion: string
): boolean => {
  const v1Parts = newVersion.split(".").map(Number);
  const v2Parts = currentVersion.split(".").map(Number);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;

    if (v1Part > v2Part) {
      return true;
    }
    if (v1Part < v2Part) {
      return false;
    }
  }

  return false;
};

export const markVersionUpdateDismissed = (version: string): void => {
  try {
    localStorage.setItem(
      VERSION_UPDATE_DISMISSED_KEY,
      JSON.stringify({
        version,
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    console.error("Error marking version as dismissed:", error);
  }
};

// Get current version from localStorage
export const getCurrentVersionFromStorage = (): string | null => {
  try {
    return localStorage.getItem(VERSION_STORAGE_KEY);
  } catch (error) {
    console.error("Error reading version from localStorage:", error);
    return null;
  }
};

// Set current version in localStorage
export const setCurrentVersionInStorage = (version: string): void => {
  try {
    localStorage.setItem(VERSION_STORAGE_KEY, version);
  } catch (error) {
    console.error("Error writing version to localStorage:", error);
  }
};

// Check if version update was recently dismissed
export const isVersionUpdateDismissed = (newVersion: string): boolean => {
  try {
    const dismissed = localStorage.getItem(VERSION_UPDATE_DISMISSED_KEY);
    if (dismissed) {
      const { version, timestamp } = JSON.parse(dismissed);
      // Check if it's the same version and dismissed within the last 6 hours
      if (
        version === newVersion &&
        Date.now() - timestamp < 6 * 60 * 60 * 1000
      ) {
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error("Error checking dismissed version:", error);
    return false;
  }
};

// Get cached changelog for a version
export const getCachedChangelog = (version: string): string | null => {
  try {
    const cached = localStorage.getItem(CHANGELOG_CACHE_KEY);
    if (cached) {
      const {
        version: cachedVersion,
        changelog: cachedChangelog,
        timestamp,
      } = JSON.parse(cached);
      // Cache is valid for 24 hours
      if (
        cachedVersion === version &&
        Date.now() - timestamp < 24 * 60 * 60 * 1000
      ) {
        return cachedChangelog;
      }
    }
    return null;
  } catch (error) {
    console.error("Error reading cached changelog:", error);
    return null;
  }
};

// Cache changelog for a version
export const cacheChangelog = (version: string, changelog: string): void => {
  try {
    localStorage.setItem(
      CHANGELOG_CACHE_KEY,
      JSON.stringify({
        version,
        changelog,
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    console.error("Error caching changelog:", error);
  }
};

// Validate message origin to prevent cross-tab or rogue service worker noise
export const isValidMessageSource = (event: MessageEvent): boolean => {
  // Check if message is from our service worker
  if (event.source && event.source !== navigator.serviceWorker.controller) {
    return false;
  }

  // Check if origin matches (for additional security)
  if (event.origin && event.origin !== window.location.origin) {
    return false;
  }

  return true;
};
