import { useCallback, useEffect, useRef, useContext, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  cacheChangelog,
  getCachedChangelog,
  getChangelogForVersion,
  isNewerVersion,
  isVersionUpdateDismissed,
  markVersionUpdateDismissed,
  getBuildTimeVersion,
} from "../utils/versionUtils";
import { useVersionContext } from "../context/versionContext";
import { GlobalInfoContext } from "../context/globalInfo";
import Button from "./Button/Button";
import Modal from "./Modal/Modal";
import MarkdownRenderer from "./MarkdownRenderer/MarkdownRenderer";

const VersionCheck: React.FC = () => {
  const {
    versionUpdate,
    setVersionUpdate,
    showUpdateModal,
    setShowUpdateModal,
    isUpdating,
    setIsUpdating,
    changelog,
    setChangelog,
    isLoadingChangelog,
    setIsLoadingChangelog,
  } = useVersionContext();

  const location = useLocation();
  const { hostId, activeInstances } = useContext(GlobalInfoContext) || {};

  // Store timeout IDs to clear on unmount
  const versionCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isUserActive = useMemo(() => {
    if (!hostId || !activeInstances) return false;
    return activeInstances.some((instance) => instance.hostId === hostId);
  }, [hostId, activeInstances]);

  const wasActiveRef = useRef<boolean>(false);

  const isControllerRoute = useCallback(() => {
    const controllerRoutes = ["/", "/controller", "/login", "/credits-editor"];
    return controllerRoutes.some(
      (route) =>
        location.pathname === route ||
        location.pathname.startsWith("/controller/")
    );
  }, [location.pathname]);

  const handleUpdate = useCallback(() => {
    setIsUpdating(true);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister();
        });
        // Wait a bit for unregister, then reload
        setTimeout(() => {
          window.location.href =
            window.location.pathname + "?cacheBust=" + Date.now();
        }, 1000);
      });
    } else {
      setTimeout(() => {
        window.location.href =
          window.location.pathname + "?cacheBust=" + Date.now();
      }, 1000);
    }
  }, [setIsUpdating]);

  // Fetch changelog for the new version (with caching)
  const fetchChangelog = useCallback(
    async (version: string) => {
      setIsLoadingChangelog(true);
      try {
        // Get current version for changelog range
        const currentVersion = getBuildTimeVersion();

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
    },
    [setChangelog, setIsLoadingChangelog]
  );

  // Check version directly from the server
  const checkVersion = useCallback(async () => {
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
        const currentVersion = getBuildTimeVersion();

        if (currentVersion && isNewerVersion(version, currentVersion)) {
          const update = {
            newVersion: version,
            currentVersion: currentVersion,
            timestamp: Date.now(),
          };
          setVersionUpdate(update);

          if (isControllerRoute()) {
            if (!isVersionUpdateDismissed(version)) {
              fetchChangelog(version);
            }
          } else {
            handleUpdate();
          }
        }
      }
    } catch (error) {
      console.error("VersionCheck: Error checking version:", error);
    }
  }, [fetchChangelog, isControllerRoute, setVersionUpdate, handleUpdate]);

  // Set up periodic version checking
  useEffect(() => {
    // Initial version check
    checkVersion();

    const startPeriodicCheck = () => {
      versionCheckTimeoutRef.current = setTimeout(() => {
        checkVersion();
        startPeriodicCheck(); // Schedule next check
      }, 6 * 60 * 60 * 1000); // 6 hours
    };

    startPeriodicCheck();

    // Cleanup function to clear timeouts
    return () => {
      if (versionCheckTimeoutRef.current) {
        clearTimeout(versionCheckTimeoutRef.current);
        versionCheckTimeoutRef.current = null;
      }
    };
  }, [checkVersion]);

  // Monitor active instances to detect when user becomes active
  useEffect(() => {
    // If user was not active before but is now active, trigger version check
    if (!wasActiveRef.current && isUserActive) {
      checkVersion();
    }

    // Update the was active state
    wasActiveRef.current = isUserActive;
  }, [isUserActive, checkVersion]);

  const handleDismiss = () => {
    setShowUpdateModal(false);
    setChangelog(null);
    // Mark this version as dismissed
    if (versionUpdate) {
      markVersionUpdateDismissed(versionUpdate.newVersion);
    }
    setVersionUpdate(null);
  };

  const handleRemindLater = () => {
    setShowUpdateModal(false);
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
      isOpen={showUpdateModal}
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
          Current version: {getBuildTimeVersion()}
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
