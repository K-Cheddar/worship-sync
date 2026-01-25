import { useState, useEffect } from "react";
import Modal from "../Modal/Modal";
import { getAppVersion } from "../../utils/environment";
import { getBuildTimeVersion } from "../../utils/versionUtils";
import { isElectron } from "../../utils/environment";
import { useUpdateCheck } from "../ElectronUpdateCheck";
import Button from "../Button/Button";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal = ({ isOpen, onClose }: AboutModalProps) => {
  const [version, setVersion] = useState<string>("");
  const [isChecking, setIsChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string>("");
  const electronUpdateCheck = useUpdateCheck();
  
  // Only use Electron update check
  const updateCheck = isElectron() ? electronUpdateCheck : null;

  useEffect(() => {
    if (isOpen) {
      const fetchVersion = async () => {
        if (isElectron()) {
          const electronVersion = await getAppVersion();
          setVersion(electronVersion || "Unknown");
        } else {
          // getBuildTimeVersion is synchronous, so we can call it directly
          setVersion(getBuildTimeVersion());
        }
      };
      fetchVersion();
      // Reset check state when modal opens
      setIsChecking(false);
      setCheckMessage("");
    }
  }, [isOpen]);

  const handleCheckForUpdates = async () => {
    if (!updateCheck) {
      setCheckMessage("Update check not available");
      return;
    }
    
    setIsChecking(true);
    setCheckMessage("");
    
    try {
      const result = await updateCheck.checkForUpdates();
      setIsChecking(false);
      
      if (result.available) {
        // Update modal will be shown by ElectronUpdateCheck
        setCheckMessage("");
      } else {
        // Filter out technical messages and show user-friendly ones
        const message = result.message;
        if (message) {
          // Don't show technical messages
          if (
            !message.includes("Not available in web version") &&
            !message.includes("Service workers not available") &&
            !message.includes("Context not initialized")
          ) {
            setCheckMessage(message);
          } else {
            setCheckMessage("You're using the latest version!");
          }
        } else {
          setCheckMessage("You're using the latest version!");
        }
      }
    } catch (error) {
      console.error("Error checking for updates:", error);
      setCheckMessage("Error checking for updates");
      setIsChecking(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="About WorshipSync" size="sm">
      <div className="text-center py-4">
        <h3 className="text-2xl font-bold text-white mb-2">WorshipSync</h3>
        <p className="text-gray-300 mb-4">Version {version}</p>
        <p className="text-gray-400 text-sm mb-4">
          Modern worship presentation software
        </p>
        
        <div className="mt-4 pt-4 border-t border-gray-600">
          <Button
            onClick={handleCheckForUpdates}
            disabled={isChecking || !updateCheck}
            variant="primary"
            className="w-full justify-center"
          >
            {isChecking ? "Checking..." : "Check for Updates"}
          </Button>
          {checkMessage && (
            <p className="text-sm text-gray-400 mt-2">{checkMessage}</p>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default AboutModal;
