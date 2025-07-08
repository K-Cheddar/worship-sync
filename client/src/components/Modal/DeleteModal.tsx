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
      <p className="text-xl mb-4">
        {message}{" "}
        {itemName && (
          <span className="font-semibold inline-block">"{itemName}"</span>
        )}
        ?
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
