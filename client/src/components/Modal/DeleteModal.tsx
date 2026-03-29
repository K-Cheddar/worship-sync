import React from "react";
import Modal from "./Modal";
import Button from "../Button/Button";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";

interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemName?: string;
  title?: string;
  message?: string;
  warningMessage?: string;
  confirmText?: string;
  cancelText?: string;
  imageUrl?: string;
  /** When true, confirm shows a spinner, both actions are disabled, and close (backdrop/Escape) is ignored. */
  isConfirming?: boolean;
}

const DeleteModal: React.FC<DeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  itemName,
  title = "Confirm Deletion",
  message = "Are you sure you want to delete",
  warningMessage = "This action is permanent and will clear your undo history.",
  confirmText = "Delete Forever",
  cancelText = "Cancel",
  imageUrl,
  isConfirming = false,
}) => {
  const resolvedImageUrl = useCachedMediaUrl(imageUrl);

  const handleClose = () => {
    if (isConfirming) return;
    onClose();
  };

  const resolvedConfirmLabel = isConfirming ? "Deleting..." : confirmText;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size="sm"
      showCloseButton={false}
      contentPadding="p-4"
      zIndexLevel={2}
    >
      {imageUrl && (
        <div className="flex justify-center mb-4">
          <div className="w-32 h-20 border-2 border-gray-600 rounded overflow-hidden">
            <img
              src={resolvedImageUrl ?? imageUrl}
              alt={itemName || "Media preview"}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}
      <p className="text-xl mb-4 wrap-break-word">
        {message}{" "}
        {itemName && <span className="font-semibold">"{itemName}"</span>}?
      </p>
      <p className="text-lg text-amber-400 mb-6">{warningMessage}</p>
      <div className="flex gap-6 w-full">
        <Button
          className="flex-1 justify-center"
          onClick={handleClose}
          disabled={isConfirming}
        >
          {cancelText}
        </Button>
        <Button
          className="flex-1 justify-center"
          variant="cta"
          onClick={onConfirm}
          disabled={isConfirming}
          isLoading={isConfirming}
        >
          {resolvedConfirmLabel}
        </Button>
      </div>
    </Modal>
  );
};

export default DeleteModal;
