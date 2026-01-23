import { useCallback, useEffect, useState } from "react";
import {
  getChangelogForVersion,
  getBuildTimeVersion,
} from "../utils/versionUtils";
import { isElectron } from "../utils/environment";
import Button from "./Button/Button";
import Modal from "./Modal/Modal";
import MarkdownRenderer from "./MarkdownRenderer/MarkdownRenderer";

const isControllerRoute = () => {
  const hash = window.location.hash.replace("#", "");
  const controllerRoutes = [
    "",
    "/",
    "/controller",
    "/login",
    "/credits-editor",
  ];
  return controllerRoutes.some(
    (route) => hash === route || hash.startsWith("/controller/")
  );
};

// Storage key for tracking dismissed PWA updates
const PWA_UPDATE_DISMISSED_KEY = "worshipSync_pwaUpdateDismissed";

const PWAUpdateCheck: React.FC = () => {
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [isLoadingChangelog, setIsLoadingChangelog] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  // Fetch changelog for the update
  const fetchChangelog = useCallback(async () => {
    setIsLoadingChangelog(true);
    try {
      const currentVersion = getBuildTimeVersion();
      // For PWA updates, fetch changelog from current version to latest
      // We'll use a high version number to get all updates since current
      const changelogContent = await getChangelogForVersion(
        "999.999.999", // Use a high version to get all updates
        currentVersion || undefined
      );
      setChangelog(changelogContent);
    } catch (error) {
      console.error("Error fetching changelog:", error);
      setChangelog(null);
    } finally {
      setIsLoadingChangelog(false);
    }
  }, []);

  // Check if PWA update was dismissed
  const isPWAUpdateDismissed = useCallback((): boolean => {
    try {
      const dismissed = localStorage.getItem(PWA_UPDATE_DISMISSED_KEY);
      if (dismissed) {
        const { timestamp } = JSON.parse(dismissed);
        // Check if dismissed within the last 6 hours
        if (Date.now() - timestamp < 6 * 60 * 60 * 1000) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("Error checking dismissed PWA update:", error);
      return false;
    }
  }, []);

  // Mark PWA update as dismissed
  const markPWAUpdateDismissed = useCallback((): void => {
    try {
      localStorage.setItem(
        PWA_UPDATE_DISMISSED_KEY,
        JSON.stringify({
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.error("Error marking PWA update as dismissed:", error);
    }
  }, []);

  // Check for waiting service worker and handle updates
  useEffect(() => {
    // Don't run in Electron
    if (isElectron() || !("serviceWorker" in navigator)) {
      return;
    }

    const checkForUpdate = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg.waiting) {
          // There's a waiting service worker (update available)
          // Only show modal if not dismissed and in controller route
          if (isControllerRoute() && !isPWAUpdateDismissed()) {
            setRegistration(reg);
            setShowUpdateModal(true);
            fetchChangelog();
          }
        }
      } catch (error) {
        console.error("Error checking for service worker update:", error);
      }
    };

    // Check immediately
    checkForUpdate();

    // Listen for service worker controller changes (update applied)
    const handleControllerChange = () => {
      // Service worker was updated, reload the page
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    // Listen for service worker registration updates
    let currentRegistration: ServiceWorkerRegistration | null = null;

    const handleUpdateFound = async () => {
      // Wait a bit for the new worker to install
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (currentRegistration && currentRegistration.waiting && isControllerRoute() && !isPWAUpdateDismissed()) {
        setRegistration(currentRegistration);
        setShowUpdateModal(true);
        fetchChangelog();
      }
    };

    // Get registration and listen for updates
    navigator.serviceWorker.ready.then((reg) => {
      currentRegistration = reg;
      
      // Check if there's already a waiting worker
      if (reg.waiting && isControllerRoute() && !isPWAUpdateDismissed()) {
        setRegistration(reg);
        setShowUpdateModal(true);
        fetchChangelog();
      }

      // Listen for new updates
      reg.addEventListener("updatefound", handleUpdateFound);
    });

    // Check periodically (every 5 minutes)
    const interval = setInterval(checkForUpdate, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      if (currentRegistration) {
        currentRegistration.removeEventListener("updatefound", handleUpdateFound);
      }
    };
  }, [fetchChangelog, isPWAUpdateDismissed]);

  const handleReload = useCallback(() => {
    if (!registration) return;
    
    setIsReloading(true);
    
    // Tell the waiting service worker to skip waiting and activate
    const waitingWorker = registration.waiting;
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }
    
    // Reload the page after a short delay
    setTimeout(() => {
      window.location.reload();
    }, 100);
  }, [registration]);

  const handleDismiss = useCallback(() => {
    setShowUpdateModal(false);
    setChangelog(null);
    markPWAUpdateDismissed();
    setRegistration(null);
  }, [markPWAUpdateDismissed]);

  const handleRemindLater = useCallback(() => {
    setShowUpdateModal(false);
    setChangelog(null);
    markPWAUpdateDismissed();
    setRegistration(null);
  }, [markPWAUpdateDismissed]);

  // Only run in web (not Electron)
  if (isElectron() || !("serviceWorker" in navigator)) {
    return null;
  }

  // Only render modal if we're in a controller route and should show update
  if (!isControllerRoute() || !showUpdateModal || !registration) {
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
          A new version of the app is available!
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
          onClick={handleReload}
          disabled={isReloading}
          variant="cta"
          className="flex-1 justify-center"
        >
          {isReloading ? "Reloading..." : "Reload to Update"}
        </Button>
      </div>

      {isReloading && (
        <div className="mt-4 text-center">
          <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-sm text-gray-300">Reloading app...</span>
        </div>
      )}
    </Modal>
  );
};

export default PWAUpdateCheck;
