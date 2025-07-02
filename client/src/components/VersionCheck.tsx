import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getChangelogForVersion } from "../utils/versionUtils";
import Button from "./Button/Button";
import Modal from "./Modal/Modal";
import MarkdownRenderer from "./MarkdownRenderer/MarkdownRenderer";

interface VersionUpdate {
  newVersion: string;
  currentVersion: string;
  timestamp: number;
}

// localStorage keys
const VERSION_STORAGE_KEY = "worshipSync_currentVersion";
const VERSION_UPDATE_DISMISSED_KEY = "worshipSync_versionUpdateDismissed";
const CHANGELOG_CACHE_KEY = "worshipSync_changelogCache";

const VersionCheck: React.FC = () => {
  const [showUpdate, setShowUpdate] = useState(false);
  const [versionUpdate, setVersionUpdate] = useState<VersionUpdate | null>(
    null
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [isLoadingChangelog, setIsLoadingChangelog] = useState(false);
  const location = useLocation();

  // Store timeout IDs to clear on unmount
  const autoRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if user is within ControllerContextWrapper routes
  const isControllerRoute = useCallback(() => {
    const controllerRoutes = ["/", "/controller", "/login", "/credits-editor"];
    return controllerRoutes.some(
      (route) =>
        location.pathname === route ||
        location.pathname.startsWith("/controller/")
    );
  }, [location.pathname]);

  // Get current version from localStorage
  const getCurrentVersionFromStorage = useCallback((): string | null => {
    try {
      return localStorage.getItem(VERSION_STORAGE_KEY);
    } catch (error) {
      console.error("Error reading version from localStorage:", error);
      return null;
    }
  }, []);

  // Set current version in localStorage
  const setCurrentVersionInStorage = useCallback((version: string): void => {
    try {
      localStorage.setItem(VERSION_STORAGE_KEY, version);
    } catch (error) {
      console.error("Error writing version to localStorage:", error);
    }
  }, []);

  // Check if version update was recently dismissed
  const isVersionUpdateDismissed = useCallback(
    (newVersion: string): boolean => {
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
    },
    []
  );

  // Mark version update as dismissed
  const markVersionUpdateDismissed = useCallback((version: string): void => {
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
  }, []);

  // Get cached changelog for a version
  const getCachedChangelog = useCallback((version: string): string | null => {
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
  }, []);

  // Cache changelog for a version
  const cacheChangelog = useCallback(
    (version: string, changelog: string): void => {
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
    },
    []
  );

  // Fetch changelog for the new version (with caching)
  const fetchChangelog = useCallback(
    async (version: string) => {
      setIsLoadingChangelog(true);
      try {
        // Check cache first
        const cachedChangelog = getCachedChangelog(version);
        if (cachedChangelog) {
          setChangelog(cachedChangelog);
          setIsLoadingChangelog(false);
          return;
        }

        // Fetch from server if not cached
        const changelogContent = await getChangelogForVersion(version);
        setChangelog(changelogContent);

        // Cache the result
        if (changelogContent) {
          cacheChangelog(version, changelogContent);
        }
      } catch (error) {
        console.error("Error fetching changelog:", error);
        setChangelog(null);
      } finally {
        setIsLoadingChangelog(false);
      }
    },
    [getCachedChangelog, cacheChangelog]
  );

  // Validate message origin to prevent cross-tab or rogue service worker noise
  const isValidMessageSource = useCallback((event: MessageEvent): boolean => {
    // Check if message is from our service worker
    if (event.source && event.source !== navigator.serviceWorker.controller) {
      return false;
    }

    // Check if origin matches (for additional security)
    if (event.origin && event.origin !== window.location.origin) {
      return false;
    }

    return true;
  }, []);

  useEffect(() => {
    // Combined message listener for all service worker messages
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      // Validate message source
      if (!isValidMessageSource(event)) {
        console.warn("Ignoring message from unexpected source:", event.origin);
        return;
      }

      // Handle VERSION_UPDATE messages
      if (event.data && event.data.type === "VERSION_UPDATE") {
        const update: VersionUpdate = {
          newVersion: event.data.version,
          currentVersion: event.data.currentVersion,
          timestamp: Date.now(),
        };
        setVersionUpdate(update);

        // If user is in controller route, show modal; otherwise auto-refresh
        if (isControllerRoute()) {
          // Check if this version update was recently dismissed
          if (!isVersionUpdateDismissed(event.data.version)) {
            setShowUpdate(true);
            // Fetch changelog for the new version
            fetchChangelog(event.data.version);
          }
        } else {
          // Auto-refresh for non-controller routes
          setIsUpdating(true);
          autoRefreshTimeoutRef.current = setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      }

      // Handle SET_VERSION messages from service worker
      if (event.data && event.data.type === "SET_VERSION") {
        setCurrentVersionInStorage(event.data.version);
      }

      // Handle GET_CURRENT_VERSION requests from service worker
      if (event.data && event.data.type === "GET_CURRENT_VERSION") {
        const currentVersion = getCurrentVersionFromStorage();
        // Send the current version back to the service worker
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "CURRENT_VERSION_RESPONSE",
            version: currentVersion,
          });
        }
      }
    };

    navigator.serviceWorker.addEventListener(
      "message",
      handleServiceWorkerMessage
    );

    // Cleanup function to clear timeouts and remove event listeners
    return () => {
      // Clear any pending timeouts
      if (autoRefreshTimeoutRef.current) {
        clearTimeout(autoRefreshTimeoutRef.current);
        autoRefreshTimeoutRef.current = null;
      }

      navigator.serviceWorker.removeEventListener(
        "message",
        handleServiceWorkerMessage
      );
    };
  }, [
    isControllerRoute,
    fetchChangelog,
    isVersionUpdateDismissed,
    setCurrentVersionInStorage,
    getCurrentVersionFromStorage,
    isValidMessageSource,
  ]);

  const handleUpdate = () => {
    setIsUpdating(true);
    // Update the stored version
    if (versionUpdate) {
      setCurrentVersionInStorage(versionUpdate.newVersion);
    }
    // Trigger service worker to skip waiting and reload
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" });
    }
    // Fallback: reload after a short delay
    autoRefreshTimeoutRef.current = setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  const handleDismiss = () => {
    setShowUpdate(false);
    setChangelog(null);
    // Mark this version as dismissed
    if (versionUpdate) {
      markVersionUpdateDismissed(versionUpdate.newVersion);
    }
    setVersionUpdate(null);
  };

  const handleRemindLater = () => {
    setShowUpdate(false);
    setChangelog(null);
    // Mark this version as dismissed (will show again after 6 hours)
    if (versionUpdate) {
      markVersionUpdateDismissed(versionUpdate.newVersion);
    }
    setVersionUpdate(null);
    // No setTimeout needed - the service worker will check again and localStorage will control visibility
  };

  // Only render modal if we're in a controller route and should show update
  if (!isControllerRoute() || !showUpdate || !versionUpdate) {
    return null;
  }

  return (
    <Modal
      isOpen={showUpdate && !!versionUpdate}
      onClose={handleDismiss}
      title="Update Available"
      size="md"
      showCloseButton={true}
    >
      <div className="mb-6">
        <p className="text-gray-300 mb-2">
          A new version ({versionUpdate?.newVersion}) is available!
        </p>
        <p className="text-gray-400 text-sm mb-4">
          Current version: {versionUpdate?.currentVersion}
        </p>

        <div className="border-t border-gray-600 pt-4">
          <h3 className="text-lg font-semibold text-white mb-3">What's New</h3>
          {isLoadingChangelog ? (
            <div className="flex items-center justify-center py-4">
              <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
              <span className="ml-2 text-sm text-gray-300">
                Loading changelog...
              </span>
            </div>
          ) : changelog ? (
            <div className="max-h-64 overflow-y-auto bg-gray-900 rounded p-4">
              <MarkdownRenderer content={changelog} />
            </div>
          ) : (
            <p className="text-gray-400 text-sm italic">
              No changelog available for this version.
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Button
          onClick={handleRemindLater}
          variant="primary"
          className="flex-1 justify-center"
        >
          Remind me later
        </Button>
        <Button
          onClick={handleUpdate}
          disabled={isUpdating}
          variant="cta"
          className="flex-1 justify-center"
        >
          {isUpdating ? "Updating..." : "Update Now"}
        </Button>
      </div>

      {isUpdating && (
        <div className="mt-4 text-center">
          <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-sm text-gray-300">Updating...</span>
        </div>
      )}
    </Modal>
  );
};

export default VersionCheck;
