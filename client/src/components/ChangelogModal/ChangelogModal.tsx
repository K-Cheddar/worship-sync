import { useState, useEffect, useCallback } from "react";
import Modal from "../Modal/Modal";
import MarkdownRenderer from "../MarkdownRenderer/MarkdownRenderer";

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ChangelogModal = ({ isOpen, onClose }: ChangelogModalProps) => {
  const [changelogContent, setChangelogContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const fetchChangelog = useCallback(async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_BASE_PATH}api/changelog`
      );
      const text = await response.text();
      setChangelogContent(text);
    } catch (error) {
      console.error("Failed to load changelog:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChangelog();
  }, [fetchChangelog]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Changelog" size="lg">
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
          <p className="text-gray-300 mt-2">Loading changelog...</p>
        </div>
      ) : (
        <div className="prose prose-invert max-w-none">
          <MarkdownRenderer
            content={changelogContent}
            className="text-gray-300"
          />
        </div>
      )}
    </Modal>
  );
};

export default ChangelogModal;
