import { useState, useEffect, useCallback } from "react";
import Modal from "../Modal/Modal";
import Button from "../Button/Button";
import { getAppVersion } from "../../utils/environment";
import {
  getBuildTimeVersion,
  getServerVersion,
  isNewerVersion,
} from "../../utils/versionUtils";
import { isElectron } from "../../utils/environment";
import * as serviceWorkerRegistration from "../../serviceWorkerRegistration";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { humanizeUpdateError } from "./updateMessages";

type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "downloading"
  | "updateDownloaded"
  | "error";

type DesktopUpdateCaps = {
  autoUpdate: boolean;
  manualReleaseDownload: boolean;
};

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateReadyVersion?: string;
}

const AboutModal = ({
  isOpen,
  onClose,
  updateReadyVersion = "",
}: AboutModalProps) => {
  const [version, setVersion] = useState<string>("");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateError, setUpdateError] = useState<string>("");
  const [updateVersion, setUpdateVersion] = useState<string>("");
  const [downloadPercent, setDownloadPercent] = useState<number>(0);
  const [updateMessage, setUpdateMessage] = useState<string>("");
  const [isGettingLatestVersion, setIsGettingLatestVersion] =
    useState<boolean>(false);
  const [reloadMessage, setReloadMessage] = useState<string>("");
  const [updateCaps, setUpdateCaps] = useState<DesktopUpdateCaps | null>(null);
  const [isRestartingInstall, setIsRestartingInstall] = useState(false);
  const [isOpeningReleaseDownload, setIsOpeningReleaseDownload] =
    useState(false);

  useEffect(() => {
    if (!isOpen) {
      setUpdateStatus("idle");
      setUpdateError("");
      setUpdateMessage("");
      setLatestVersion(null);
      setReloadMessage("");
      setIsGettingLatestVersion(false);
      setUpdateCaps(null);
      setIsRestartingInstall(false);
      setIsOpeningReleaseDownload(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const fetchVersion = async () => {
        if (isElectron()) {
          const electronVersion = await getAppVersion();
          setVersion(electronVersion || "");
        } else {
          const buildVersion = getBuildTimeVersion();
          setVersion(buildVersion);
          const serverVersion = await getServerVersion();
          if (serverVersion) {
            setLatestVersion(serverVersion);
            if (serverVersion !== buildVersion) {
              setVersion(buildVersion);
            } else {
              setVersion(serverVersion);
            }
          }
        }
      };
      fetchVersion();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !updateReadyVersion) {
      return;
    }

    setUpdateVersion(updateReadyVersion);
    setUpdateStatus("updateDownloaded");
    setDownloadPercent(100);
  }, [isOpen, updateReadyVersion]);

  useEffect(() => {
    if (
      !isOpen ||
      !isElectron() ||
      !window.electronAPI?.getDesktopUpdateCapabilities
    ) {
      return;
    }
    let cancelled = false;
    void window.electronAPI
      .getDesktopUpdateCapabilities()
      .then((c) => {
        if (!cancelled) {
          setUpdateCaps(c);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUpdateCaps({ autoUpdate: true, manualReleaseDownload: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!isElectron() || !window.electronAPI?.checkForUpdates) return;
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const result = await window.electronAPI.checkForUpdates();
      if (result.error) {
        setUpdateStatus("error");
        setUpdateError(humanizeUpdateError(result.error));
      } else if (result.message) {
        setUpdateStatus("upToDate");
        setUpdateMessage(result.message);
      } else if (result.available && result.updateInfo?.version) {
        const newVer = result.updateInfo.version;
        const current = version || (await getAppVersion()) || "";
        if (isNewerVersion(newVer, current)) {
          setUpdateVersion(newVer);
          // autoDownload is on in main: progress events may arrive before this IPC
          // returns. Never downgrade downloading / downloaded back to "available".
          setUpdateStatus((prev) => {
            if (prev === "updateDownloaded") return prev;
            if (prev === "downloading") return prev;
            return "downloading";
          });
          setDownloadPercent((p) => (p > 0 ? p : 0));
        } else {
          setUpdateStatus("upToDate");
        }
      } else {
        setUpdateStatus("upToDate");
      }
    } catch {
      setUpdateStatus("error");
      setUpdateError(
        humanizeUpdateError(
          "Could not check for updates. Check your connection and try again.",
        ),
      );
    }
  }, [version]);

  const handleRestartToInstall = useCallback(async () => {
    if (!isElectron() || !window.electronAPI?.installUpdate) return;
    setIsRestartingInstall(true);
    setUpdateError("");
    try {
      const result = await window.electronAPI.installUpdate();
      if (!result.ok) {
        setUpdateStatus("error");
        const raw = result.error || "Could not restart to install.";
        setUpdateError(humanizeUpdateError(raw));
      }
    } catch {
      setUpdateStatus("error");
      setUpdateError(
        humanizeUpdateError("Could not restart to install. Try again."),
      );
    } finally {
      setIsRestartingInstall(false);
    }
  }, []);

  const handleOpenDesktopReleaseDownload = useCallback(async () => {
    if (!isElectron() || !window.electronAPI?.openDesktopReleaseDownload) {
      return;
    }
    setIsOpeningReleaseDownload(true);
    setUpdateError("");
    try {
      const res = await window.electronAPI.openDesktopReleaseDownload();
      if (!res.ok) {
        setUpdateError(
          humanizeUpdateError(
            res.error || "Could not open the download page.",
          ),
        );
      }
    } catch {
      setUpdateError(
        humanizeUpdateError("Could not open the download page."),
      );
    } finally {
      setIsOpeningReleaseDownload(false);
    }
  }, []);

  const handleGetLatestVersion = useCallback(async () => {
    if (isElectron()) return;
    setIsGettingLatestVersion(true);
    setReloadMessage("");
    try {
      if (navigator.serviceWorker?.controller) {
        await serviceWorkerRegistration.checkForUpdate();
        // If an update was found, main.tsx onUpdate will reload the page.
        // If still here after a short delay, no update was found.
        setTimeout(() => {
          setIsGettingLatestVersion(false);
          setReloadMessage("You're on the latest version.");
        }, 3000);
      } else {
        window.location.reload();
      }
    } catch {
      setIsGettingLatestVersion(false);
      setReloadMessage("Could not check for update.");
    }
  }, []);

  useEffect(() => {
    if (
      !isOpen ||
      !isElectron() ||
      !window.electronAPI ||
      !updateCaps?.autoUpdate
    ) {
      return;
    }
    const unsubAvailable = window.electronAPI.onUpdateAvailable?.((info) => {
      getAppVersion().then((current) => {
        if (current && isNewerVersion(info.version, current)) {
          setUpdateVersion(info.version);
          setUpdateStatus((prev) => {
            if (prev === "updateDownloaded") return prev;
            return "downloading";
          });
          setDownloadPercent((p) => (p > 0 ? p : 0));
        }
      });
    });
    const unsubNotAvailable = window.electronAPI.onUpdateNotAvailable?.(() => {
      setUpdateStatus((prev) => {
        if (prev === "downloading" || prev === "updateDownloaded") return prev;
        if (prev === "error") return prev;
        return "upToDate";
      });
    });
    const unsubDownloaded = window.electronAPI.onUpdateDownloaded?.((info) => {
      setUpdateVersion(info.version);
      setUpdateStatus("updateDownloaded");
      setDownloadPercent(100);
    });
    const unsubProgress = window.electronAPI.onUpdateDownloadProgress?.((progress) => {
      setUpdateStatus("downloading");
      setDownloadPercent(progress.percent);
    });
    const unsubError = window.electronAPI.onUpdateError?.((error) => {
      setUpdateStatus("error");
      setUpdateError(humanizeUpdateError(error.message));
    });
    return () => {
      unsubAvailable?.();
      unsubNotAvailable?.();
      unsubDownloaded?.();
      unsubProgress?.();
      unsubError?.();
    };
  }, [isOpen, updateCaps?.autoUpdate]);

  const showDesktopUpdateSection =
    isElectron() &&
    updateCaps != null &&
    (updateCaps.autoUpdate || updateCaps.manualReleaseDownload);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="About WorshipSync" size="sm">
      <div className="text-center py-4">
        <h3 className="text-2xl font-bold text-white mb-2">WorshipSync</h3>
        <p className="text-gray-300 mb-4">Version {version}</p>
        {!isElectron() &&
          latestVersion &&
          latestVersion !== version &&
          isNewerVersion(latestVersion, version) && (
            <p className="text-gray-400 text-sm mb-4">
              Latest version: {latestVersion}
            </p>
          )}
        <p className="text-gray-400 text-sm mb-4">
          Modern worship presentation software
        </p>
        {!isElectron() &&
          latestVersion &&
          isNewerVersion(latestVersion, version) && (
            <div className="border-t border-gray-700 pt-4 mt-4 w-full flex flex-col gap-2 items-center">
              {reloadMessage && (
                <p className="text-sm text-gray-400">{reloadMessage}</p>
              )}
              <Button
                onClick={handleGetLatestVersion}
                svg={RefreshCw}
                isLoading={isGettingLatestVersion}
                disabled={isGettingLatestVersion}
              >
                {isGettingLatestVersion
                  ? "Checking for update…"
                  : "Get latest version"}
              </Button>
            </div>
          )}
        {showDesktopUpdateSection && (
          <div className="border-t border-gray-700 pt-4 mt-4 space-y-3 w-full flex flex-col gap-2 items-center">
            {updateCaps?.manualReleaseDownload && (
              <div className="w-full flex flex-col gap-2 items-center">
                <p className="text-sm text-gray-400 max-w-sm">
                  macOS builds install from the disk image on GitHub. Your
                  browser will download the latest release.
                </p>
                {updateError && !updateCaps?.autoUpdate ? (
                  <p className="text-sm text-red-400">{updateError}</p>
                ) : null}
                <Button
                  variant="cta"
                  onClick={() => void handleOpenDesktopReleaseDownload()}
                  svg={Download}
                  className="w-full justify-center gap-2"
                  isLoading={isOpeningReleaseDownload}
                  disabled={isOpeningReleaseDownload}
                >
                  Download latest version
                </Button>
              </div>
            )}
            {updateCaps?.autoUpdate && (
              <>
                <div className="min-h-5 w-full" aria-live="polite">
                  {updateStatus === "error" && (
                    <p className="text-sm text-red-400">{updateError}</p>
                  )}
                  {updateStatus === "upToDate" && (
                    <p className="text-sm text-gray-400">
                      {updateMessage || "You're up to date."}
                    </p>
                  )}
                  {updateStatus === "downloading" && (
                    <p className="text-sm text-gray-300">
                      {downloadPercent > 0
                        ? `Downloading update ${updateVersion}… ${Math.round(downloadPercent)}%`
                        : `Downloading update ${updateVersion}…`}
                    </p>
                  )}
                </div>
                {updateStatus === "updateDownloaded" && (
                  <>
                    <p className="text-sm text-gray-300">
                      Update {updateVersion} ready to install.
                    </p>
                    <Button
                      variant="cta"
                      onClick={() => void handleRestartToInstall()}
                      svg={RotateCw}
                      className="w-full justify-center gap-2"
                      isLoading={isRestartingInstall}
                      disabled={isRestartingInstall}
                    >
                      Restart to install
                    </Button>
                  </>
                )}
                {updateStatus !== "updateDownloaded" && (
                  <Button
                    onClick={handleCheckForUpdates}
                    svg={RefreshCw}
                    className="w-full justify-center gap-2"
                    isLoading={updateStatus === "checking"}
                    disabled={
                      updateStatus === "checking" ||
                      updateStatus === "downloading"
                    }
                    aria-label={
                      updateStatus === "downloading"
                        ? "Update download in progress"
                        : undefined
                    }
                  >
                    {updateStatus === "checking"
                      ? "Checking…"
                      : "Check for updates"}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AboutModal;
