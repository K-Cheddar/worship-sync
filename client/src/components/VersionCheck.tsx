import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  cacheChangelog,
  getCachedChangelog,
  getChangelogForVersion,
  getCurrentVersionFromStorage,
  isNewerVersion,
  isValidMessageSource,
  isVersionUpdateDismissed,
  markVersionUpdateDismissed,
  setCurrentVersionInStorage,
} from "../utils/versionUtils";
import Button from "./Button/Button";
import Modal from "./Modal/Modal";
import MarkdownRenderer from "./MarkdownRenderer/MarkdownRenderer";

interface VersionUpdate {
  newVersion: string;
  currentVersion: string;
  timestamp: number;
}

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

  // Fetch changelog for the new version (with caching)
  const fetchChangelog = useCallback(async (version: string) => {
    setIsLoadingChangelog(true);
    try {
      // Get current version for changelog range
      const currentVersion = getCurrentVersionFromStorage();

      // Check cache first (use both versions for cache key)
      const cacheKey = currentVersion
        ? `${currentVersion}-${version}`
        : version;
      const cachedChangelog = getCachedChangelog(cacheKey);
      if (cachedChangelog) {
        setChangelog(cachedChangelog);
        setIsLoadingChangelog(false);
        return;
      }

      // Fetch from server if not cached
      const changelogContent = await getChangelogForVersion(
        version,
        currentVersion || undefined
      );
      setChangelog(changelogContent);

      // Cache the result
      if (changelogContent) {
        cacheChangelog(cacheKey, changelogContent);
      }
    } catch (error) {
      console.error("Error fetching changelog:", error);
      setChangelog(null);
    } finally {
      setIsLoadingChangelog(false);
    }
  }, []);

  // Fallback function to check version directly (when service worker is not available)
  const checkVersionDirectly = useCallback(async () => {
    try {
      const baseUrl = window.location.origin;
      const apiPath = baseUrl.includes("localhost")
        ? "http://localhost:5000"
        : baseUrl;

      const response = await fetch(`${apiPath}/api/version`, {
        cache: "no-cache",
      });

      if (response.ok) {
        const { version } = await response.json();
        const currentVersion = getCurrentVersionFromStorage();

        if (currentVersion && isNewerVersion(version, currentVersion)) {
          const update: VersionUpdate = {
            newVersion: version,
            currentVersion: currentVersion,
            timestamp: Date.now(),
          };
          setVersionUpdate(update);

          if (isControllerRoute()) {
            if (!isVersionUpdateDismissed(version)) {
              setShowUpdate(true);
              fetchChangelog(version);
            }
          } else {
            setIsUpdating(true);
            // Update the stored version since the user is effectively updating via auto-refresh
            setCurrentVersionInStorage(version);
            autoRefreshTimeoutRef.current = setTimeout(() => {
              window.location.reload();
            }, 1000);
          }
        }
      }
    } catch (error) {
      console.error("VersionCheck: Error in direct version check:", error);
    }
  }, [fetchChangelog, isControllerRoute]);

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
          // Update the stored version since the user is effectively updating via auto-refresh
          setCurrentVersionInStorage(event.data.version);
          autoRefreshTimeoutRef.current = setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
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

    // Wait for service worker to be ready before triggering version check
    navigator.serviceWorker.ready
      .then((registration) => {
        // Trigger an initial version check when service worker is ready
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "CHECK_VERSION",
          });
        } else {
          // Fallback: try to check version directly if service worker is not available
          checkVersionDirectly();
        }
      })
      .catch((error) => {
        console.error("VersionCheck: Error waiting for service worker:", error);
        // Fallback: try to check version directly if service worker fails
        checkVersionDirectly();
      });

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
  }, [isControllerRoute, fetchChangelog, checkVersionDirectly]);

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
  };

  // Only render modal if we're in a controller route and should show update
  if (!isControllerRoute()) {
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
