import { useState, useEffect, useCallback } from "react";
import Modal from "../Modal/Modal";
import Button from "../Button/Button";
import { getAppVersion } from "../../utils/environment";
import { getBuildTimeVersion } from "../../utils/versionUtils";
import { isElectron } from "../../utils/environment";
import { RefreshCw, RotateCw } from "lucide-react";

type UpdateStatus = "idle" | "checking" | "upToDate" | "updateAvailable" | "downloading" | "updateDownloaded" | "error";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal = ({ isOpen, onClose }: AboutModalProps) => {
  const [version, setVersion] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateError, setUpdateError] = useState<string>("");
  const [updateVersion, setUpdateVersion] = useState<string>("");
  const [downloadPercent, setDownloadPercent] = useState<number>(0);
  const [updateMessage, setUpdateMessage] = useState<string>("");

  useEffect(() => {
    if (!isOpen) {
      setUpdateStatus("idle");
      setUpdateError("");
      setUpdateMessage("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const fetchVersion = async () => {
        if (isElectron()) {
          const electronVersion = await getAppVersion();
          setVersion(electronVersion || "");
        } else {
          setVersion(getBuildTimeVersion());
        }
      };
      fetchVersion();
    }
  }, [isOpen]);

  const handleCheckForUpdates = useCallback(async () => {
    if (!isElectron() || !window.electronAPI?.checkForUpdates) return;
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const result = await window.electronAPI.checkForUpdates();
      if (result.error) {
        setUpdateStatus("error");
        setUpdateError(result.error);
      } else if (result.message) {
        setUpdateStatus("upToDate");
        setUpdateMessage(result.message);
      } else if (result.available && result.updateInfo) {
        setUpdateVersion(result.updateInfo.version ?? "");
        setUpdateStatus("updateAvailable");
      } else {
        setUpdateStatus("upToDate");
      }
    } catch {
      setUpdateStatus("error");
      setUpdateError("Failed to check for updates.");
    }
  }, []);

  const handleRestartToInstall = useCallback(() => {
    if (!isElectron() || !window.electronAPI?.installUpdate) return;
    window.electronAPI.installUpdate();
  }, []);

  useEffect(() => {
    if (!isOpen || !isElectron() || !window.electronAPI) return;
    const unsubAvailable = window.electronAPI.onUpdateAvailable?.((info) => {
      setUpdateVersion(info.version);
      setUpdateStatus("updateAvailable");
    });
    const unsubNotAvailable = window.electronAPI.onUpdateNotAvailable?.(() => {
      setUpdateStatus("upToDate");
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
      setUpdateError(error.message);
    });
    return () => {
      unsubAvailable?.();
      unsubNotAvailable?.();
      unsubDownloaded?.();
      unsubProgress?.();
      unsubError?.();
    };
  }, [isOpen]);

  const showUpdateSection = isElectron() && window.electronAPI?.checkForUpdates;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="About WorshipSync" size="sm">
      <div className="text-center py-4">
        <h3 className="text-2xl font-bold text-white mb-2">WorshipSync</h3>
        <p className="text-gray-300 mb-4">Version {version}</p>
        <p className="text-gray-400 text-sm mb-4">
          Modern worship presentation software
        </p>
        {showUpdateSection && (
          <div className="border-t border-gray-700 pt-4 mt-4 space-y-3 w-full flex flex-col gap-2 items-center">
            {updateStatus === "error" && (
              <p className="text-sm text-red-400">{updateError}</p>
            )}
            {updateStatus === "upToDate" && (
              <p className="text-sm text-gray-400">{updateMessage || "You're up to date."}</p>
            )}
            {(updateStatus === "updateAvailable" || updateStatus === "downloading") && (
              <p className="text-sm text-gray-300">
                {updateStatus === "downloading"
                  ? `Downloading update ${updateVersion}… ${Math.round(downloadPercent)}%`
                  : `Update available: ${updateVersion}`}
              </p>
            )}
            {updateStatus === "updateDownloaded" && (
              <>
                <p className="text-sm text-gray-300">Update {updateVersion} ready to install.</p>
                <Button
                  variant="cta"
                  onClick={handleRestartToInstall}
                  svg={RotateCw}
                  className="w-full"
                >
                  Restart to install
                </Button>
              </>
            )}
            <Button
              onClick={handleCheckForUpdates}
              svg={RefreshCw}
              isLoading={updateStatus === "checking"}
              disabled={updateStatus === "checking"}
            >
              {updateStatus === "checking" ? "Checking…" : "Check for updates"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AboutModal;
