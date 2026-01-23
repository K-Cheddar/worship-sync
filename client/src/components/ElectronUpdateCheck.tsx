import { useCallback, useEffect, useState, createContext, useContext, useMemo } from "react";
import {
  getChangelogForVersion,
  getBuildTimeVersion,
  isVersionUpdateDismissed,
  markVersionUpdateDismissed,
} from "../utils/versionUtils";
import { isElectron, getAppVersion } from "../utils/environment";
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

// Context for manually triggering update checks
interface UpdateCheckContextType {
  checkForUpdates: () => Promise<{ available: boolean; message?: string }>;
}

// Default context value - should never be used if provider is in tree
const defaultContextValue: UpdateCheckContextType = {
  checkForUpdates: async () => ({ available: false, message: "Not available in web version" }),
};

export const UpdateCheckContext = createContext<UpdateCheckContextType>(defaultContextValue);

export const useUpdateCheck = () => {
  const context = useContext(UpdateCheckContext);
  return context;
};

const ElectronUpdateCheck: React.FC = () => {
  // Call all hooks first (Rules of Hooks)
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    releaseDate?: string;
  } | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isInstalling, setIsInstalling] = useState(false);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [isLoadingChangelog, setIsLoadingChangelog] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [isManualCheck, setIsManualCheck] = useState(false);

  // Fetch current version on mount
  useEffect(() => {
    const fetchCurrentVersion = async () => {
      if (isElectron()) {
        const version = await getAppVersion();
        setCurrentVersion(version || getBuildTimeVersion());
      } else {
        setCurrentVersion(getBuildTimeVersion());
      }
    };
    fetchCurrentVersion();
  }, []);

  // Fetch changelog for the new version
  const fetchChangelog = useCallback(
    async (version: string) => {
      setIsLoadingChangelog(true);
      try {
        const currentVer = currentVersion || getBuildTimeVersion();
        const changelogContent = await getChangelogForVersion(
          version,
          currentVer || undefined
        );
        setChangelog(changelogContent);
      } catch (error) {
        console.error("Error fetching changelog:", error);
        setChangelog(null);
      } finally {
        setIsLoadingChangelog(false);
      }
    },
    [currentVersion]
  );

  // Check for updates on mount to catch any that were missed during initial load
  useEffect(() => {
    if (!window.electronAPI || !isElectron()) return;

    const electronAPI = window.electronAPI;
    // Small delay to ensure everything is initialized
    const checkOnMount = async () => {
      try {
        const result = await electronAPI.checkForUpdates();
        if (result.available && result.updateInfo) {
          const updateInfo = {
            version: result.updateInfo.version,
            releaseDate: result.updateInfo.releaseDate,
          };
          setUpdateInfo(updateInfo);
          
          // Show modal if in controller route and not dismissed
          if (isControllerRoute() && !isVersionUpdateDismissed(updateInfo.version)) {
            setShowUpdateModal(true);
            fetchChangelog(updateInfo.version);
          }
        }
      } catch (error) {
        console.error("Error checking for updates on mount:", error);
      }
    };

    // Delay slightly to ensure route is determined
    const timeoutId = setTimeout(checkOnMount, 500);
    return () => clearTimeout(timeoutId);
  }, [fetchChangelog]);

  // Watch for route changes and show update modal if we have a pending update
  useEffect(() => {
    if (!updateInfo) return;

    const checkAndShowUpdate = () => {
      // Don't show if already showing, is manual check, or was dismissed
      if (showUpdateModal || isManualCheck || isVersionUpdateDismissed(updateInfo.version)) {
        return;
      }

      // If we're in a controller route, show the update modal
      if (isControllerRoute()) {
        setShowUpdateModal(true);
        fetchChangelog(updateInfo.version);
      }
    };

    // Check immediately
    checkAndShowUpdate();

    // Also listen for hash changes (since we're using HashRouter)
    const handleHashChange = () => {
      checkAndShowUpdate();
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [updateInfo, showUpdateModal, isManualCheck, fetchChangelog]);

  // Listen to update events
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanupAvailable = window.electronAPI.onUpdateAvailable?.((info) => {
      console.log("Update available:", info);
      setUpdateInfo(info);
      
      // Show modal if:
      // 1. In controller route AND (not dismissed OR manual check)
      // 2. OR if it's a manual check (regardless of route)
      const shouldShow = isManualCheck || 
        (isControllerRoute() && (!isVersionUpdateDismissed(info.version) || isManualCheck));
      
      if (shouldShow) {
        setShowUpdateModal(true);
        fetchChangelog(info.version);
      }
    });

    const cleanupDownloaded = window.electronAPI.onUpdateDownloaded?.((info) => {
      console.log("Update downloaded:", info);
      setIsDownloading(false);
      setDownloadProgress(100);
      // Show install prompt
      setShowUpdateModal(true);
    });

    const cleanupProgress = window.electronAPI.onUpdateDownloadProgress?.((progress) => {
      setDownloadProgress(progress.percent);
    });

    const cleanupError = window.electronAPI.onUpdateError?.((error) => {
      console.error("Update error:", error);
      setIsDownloading(false);
    });

    return () => {
      cleanupAvailable?.();
      cleanupDownloaded?.();
      cleanupProgress?.();
      cleanupError?.();
    };
  }, [fetchChangelog, isManualCheck]);

  const handleDownload = useCallback(async () => {
    if (!window.electronAPI) return;
    
    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      await window.electronAPI.downloadUpdate?.();
    } catch (error) {
      console.error("Error downloading update:", error);
      setIsDownloading(false);
    }
  }, []);

  const handleInstall = useCallback(() => {
    if (!window.electronAPI) return;
    
    setIsInstalling(true);
    window.electronAPI.installUpdate?.();
  }, []);

  const handleDismiss = () => {
    setShowUpdateModal(false);
    setChangelog(null);
    setIsManualCheck(false);
    if (updateInfo) {
      markVersionUpdateDismissed(updateInfo.version);
    }
    setUpdateInfo(null);
  };

  // Manual update check function
  const checkForUpdates = useCallback(async (): Promise<{ available: boolean; message?: string }> => {
    if (!window.electronAPI) {
      return { available: false, message: "Update check not available" };
    }
    
    setIsManualCheck(true);
    try {
      const result = await window.electronAPI.checkForUpdates();
      if (result.available && result.updateInfo) {
        setUpdateInfo({
          version: result.updateInfo.version,
          releaseDate: result.updateInfo.releaseDate,
        });
        setShowUpdateModal(true);
        fetchChangelog(result.updateInfo.version);
        return { available: true };
      } else if (result.error) {
        return { available: false, message: result.error };
      } else if (result.message) {
        return { available: false, message: result.message };
      } else {
        return { available: false, message: "You're using the latest version!" };
      }
    } catch (error: any) {
      console.error("Error checking for updates:", error);
      return { available: false, message: error.message || "Error checking for updates" };
    }
  }, [fetchChangelog]);

  const handleRemindLater = () => {
    setShowUpdateModal(false);
    setChangelog(null);
    setIsManualCheck(false);
    if (updateInfo) {
      markVersionUpdateDismissed(updateInfo.version);
    }
    setUpdateInfo(null);
  };

  // Render modal if update info exists and modal should be shown
  // Allow showing outside controller route if it's a manual check
  const shouldRenderModal = showUpdateModal && updateInfo && (isControllerRoute() || isManualCheck);
  const isDownloaded = downloadProgress === 100 && !isDownloading;

  // Always provide context, even if not in Electron (for consistency)
  // But only render modal if in Electron and conditions are met
  // Create a stable fallback function for web/non-Electron environments
  const fallbackCheckForUpdates = useCallback(async () => {
    return { available: false, message: "Not available in web version" };
  }, []);

  // Memoize the context value to prevent unnecessary re-renders
  // Always provide a valid context value - use checkForUpdates if in Electron, otherwise fallback
  const contextValue = useMemo(() => {
    const isElectronEnv = isElectron() && window.electronAPI;
    if (isElectronEnv) {
      // In Electron, use the real checkForUpdates function
      return { checkForUpdates };
    }
    // In web, use the fallback
    return { checkForUpdates: fallbackCheckForUpdates };
  }, [checkForUpdates, fallbackCheckForUpdates]);

  // Ensure context is always provided
  // The provider must always render to make context available to children
  return (
    <UpdateCheckContext.Provider value={contextValue}>
      {isElectron() && window.electronAPI && shouldRenderModal && (
        <Modal
          isOpen={showUpdateModal}
          onClose={handleDismiss}
          title="Update Available"
          size="md"
          showCloseButton={true}
        >
          <div className="mb-6">
            <p className="text-gray-300 mb-2">
              A new version ({updateInfo.version}) is available!
            </p>
            <p className="text-gray-400 text-sm mb-4">
              Current version: {currentVersion || getBuildTimeVersion()}
            </p>

            {isDownloading && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-300">Downloading update...</span>
                  <span className="text-sm text-gray-400">{Math.round(downloadProgress)}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            )}

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
            {!isDownloaded ? (
              <>
                <Button
                  onClick={handleRemindLater}
                  variant="primary"
                  className="flex-1 justify-center"
                >
                  Remind me later
                </Button>
                <Button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  variant="cta"
                  className="flex-1 justify-center"
                >
                  {isDownloading ? `Downloading... ${Math.round(downloadProgress)}%` : "Download Update"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleDismiss}
                  variant="primary"
                  className="flex-1 justify-center"
                >
                  Install Later
                </Button>
                <Button
                  onClick={handleInstall}
                  disabled={isInstalling}
                  variant="cta"
                  className="flex-1 justify-center"
                >
                  {isInstalling ? "Installing..." : "Install & Restart"}
                </Button>
              </>
            )}
          </div>

          {isInstalling && (
            <div className="mt-4 text-center">
              <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
              <span className="ml-2 text-sm text-gray-300">Installing update...</span>
            </div>
          )}
        </Modal>
      )}
    </UpdateCheckContext.Provider>
  );

};

export default ElectronUpdateCheck;
