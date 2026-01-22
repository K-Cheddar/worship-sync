import { useCallback, useEffect, useRef, useContext, useState } from "react";
import {
  getChangelogForVersion,
  getBuildTimeVersion,
  isVersionUpdateDismissed,
  markVersionUpdateDismissed,
} from "../utils/versionUtils";
import { GlobalInfoContext } from "../context/globalInfo";
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

const ElectronUpdateCheck: React.FC = () => {
  // Only run in Electron
  if (!isElectron() || !window.electronAPI) {
    return null;
  }

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

  const { hostId, activeInstances } = useContext(GlobalInfoContext) || {};

  // Fetch changelog for the new version
  const fetchChangelog = useCallback(
    async (version: string) => {
      setIsLoadingChangelog(true);
      try {
        const currentVersion = getBuildTimeVersion();
        const changelogContent = await getChangelogForVersion(
          version,
          currentVersion || undefined
        );
        setChangelog(changelogContent);
      } catch (error) {
        console.error("Error fetching changelog:", error);
        setChangelog(null);
      } finally {
        setIsLoadingChangelog(false);
      }
    },
    []
  );

  // Listen to update events
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanupAvailable = window.electronAPI.onUpdateAvailable?.((info) => {
      console.log("Update available:", info);
      setUpdateInfo(info);
      
      // Only show modal if not dismissed and in controller route
      if (isControllerRoute() && !isVersionUpdateDismissed(info.version)) {
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
  }, [fetchChangelog]);

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
    if (updateInfo) {
      markVersionUpdateDismissed(updateInfo.version);
    }
    setUpdateInfo(null);
  };

  const handleRemindLater = () => {
    setShowUpdateModal(false);
    setChangelog(null);
    if (updateInfo) {
      markVersionUpdateDismissed(updateInfo.version);
    }
    setUpdateInfo(null);
  };

  // Only render modal if we're in a controller route and should show update
  if (!isControllerRoute() || !showUpdateModal || !updateInfo) {
    return null;
  }

  const isDownloaded = downloadProgress === 100 && !isDownloading;

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
          A new version ({updateInfo.version}) is available!
        </p>
        <p className="text-gray-400 text-sm mb-4">
          Current version: {getBuildTimeVersion()}
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
  );
};

export default ElectronUpdateCheck;
