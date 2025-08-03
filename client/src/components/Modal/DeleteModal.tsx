import React from "react";
import Modal from "./Modal";
import Button from "../Button/Button";

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
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      showCloseButton={false}
      contentPadding="p-4"
    >
      {imageUrl && (
        <div className="flex justify-center mb-4">
          <div className="w-32 h-20 border-2 border-gray-600 rounded overflow-hidden">
            <img
              src={imageUrl}
              alt={itemName || "Media preview"}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}
      <p className="text-xl mb-4 break-words">
        {message}{" "}
        {itemName && <span className="font-semibold">"{itemName}"</span>}?
      </p>
      <p className="text-lg text-amber-400 mb-6">{warningMessage}</p>
      <div className="flex gap-6 w-full">
        <Button className="flex-1 justify-center" onClick={onClose}>
          {cancelText}
        </Button>
        <Button
          className="flex-1 justify-center"
          variant="cta"
          onClick={onConfirm}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
};

export default DeleteModal;
