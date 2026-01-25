import { useState, useEffect } from "react";
import Modal from "../Modal/Modal";
import { getAppVersion } from "../../utils/environment";
import { getBuildTimeVersion } from "../../utils/versionUtils";
import { isElectron } from "../../utils/environment";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal = ({ isOpen, onClose }: AboutModalProps) => {
  const [version, setVersion] = useState<string>("");

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="About WorshipSync" size="sm">
      <div className="text-center py-4">
        <h3 className="text-2xl font-bold text-white mb-2">WorshipSync</h3>
        <p className="text-gray-300 mb-4">Version {version}</p>
        <p className="text-gray-400 text-sm mb-4">
          Modern worship presentation software
        </p>
      </div>
    </Modal>
  );
};

export default AboutModal;
