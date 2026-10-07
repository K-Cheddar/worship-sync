import React, { useId } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";

interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemName?: string;
  title?: string;
  message?: string;
  warningMessage?: string;
  /** Optional list of side effects this deletion will cause (e.g. "Removed from 2 teams"). */
  impacts?: string[];
  confirmText?: string;
  cancelText?: string;
  imageUrl?: string;
  imagePreview?: React.ReactNode;
  /** When true, confirm shows a spinner, both actions are disabled, and close (backdrop/Escape) is ignored. */
  isConfirming?: boolean;
  /** Label on the confirm button while `isConfirming` is true (default: "Deleting..."). */
  confirmingLabel?: string;
}

const DeleteModal: React.FC<DeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  itemName,
  title = "Confirm Deletion",
  message = "Are you sure you want to delete",
  warningMessage = "This action is permanent and will clear your undo history.",
  impacts,
  confirmText = "Delete Forever",
  cancelText = "Cancel",
  imageUrl,
  imagePreview,
  isConfirming = false,
  confirmingLabel = "Deleting...",
}) => {
  const resolvedImageUrl = useCachedMediaUrl(imageUrl);
  const descriptionId = useId();

  const handleClose = () => {
    if (isConfirming) return;
    onClose();
  };

  const resolvedConfirmLabel = isConfirming ? confirmingLabel : confirmText;

  return (
    <ConfirmDialog
      open={isOpen}
      onCancel={handleClose}
      onConfirm={onConfirm}
      confirmLabel={resolvedConfirmLabel}
      cancelLabel={cancelText}
      destructive
      busy={isConfirming}
      cancelVariant="primary"
      actionsClassName="flex gap-6 w-full"
      title={title}
      descriptionId={`${descriptionId} ${descriptionId}-warning`}
      size="sm"
      showCloseButton={false}
      contentPadding="p-4"
      zIndexLevel={2}
    >
      {(imagePreview || imageUrl) && (
        <div className="flex justify-center mb-4">
          <div className="w-32 h-20 border-2 border-gray-600 rounded overflow-hidden">
            {imagePreview ?? <img
              src={resolvedImageUrl ?? imageUrl}
              alt={itemName || "Media preview"}
              className="w-full h-full object-cover"
            />}
          </div>
        </div>
      )}
      <p id={descriptionId} className="text-xl mb-4 wrap-break-word text-white">
        {message}{" "}
        {itemName && <span className="font-semibold">"{itemName}"</span>}?
      </p>
      {impacts && impacts.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="mb-1 text-sm font-semibold text-amber-200">
            This will also:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100">
            {impacts.map((impact, index) => (
              <li key={index}>{impact}</li>
            ))}
          </ul>
        </div>
      )}
      <p id={`${descriptionId}-warning`} className="text-lg text-amber-400 mb-6">{warningMessage}</p>
    </ConfirmDialog>
  );
};

export default DeleteModal;
