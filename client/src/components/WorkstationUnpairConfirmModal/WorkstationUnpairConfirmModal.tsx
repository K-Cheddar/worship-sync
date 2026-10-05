import ConfirmDialog from "../Modal/ConfirmDialog";

export const WORKSTATION_UNLINK_TRIGGER_LABEL = "Unlink this computer";

/** Account menu on shared workstation: ends operator session; keeps device link for the next person. */
export const WORKSTATION_END_SESSION_LABEL = "End session";

type WorkstationUnpairConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isConfirming?: boolean;
};

const WorkstationUnpairConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  isConfirming = false,
}: WorkstationUnpairConfirmModalProps) => {
  const handleClose = () => {
    if (isConfirming) return;
    onClose();
  };

  return (
    <ConfirmDialog
      open={isOpen}
      onCancel={handleClose}
      onConfirm={() => void onConfirm()}
      confirmLabel="Unlink"
      destructive
      busy={isConfirming}
      cancelVariant="tertiary"
      title="Unlink this computer?"
      description="This signs you out and removes this computer as a shared workstation."
      size="sm"
      showCloseButton={!isConfirming}
      contentPadding="p-4"
      zIndexLevel={2}
    >
      <div className="space-y-4 text-sm text-gray-200">
        <p>
          This signs you out and removes this computer from your church as a{" "}
          <span className="text-white">shared workstation</span>. Contact a WorshipSync admin for your church if you need this device
          linked again later.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-gray-300">
          <li>
            If you&apos;re only handing off to the next person and this computer should stay linked,
            cancel this action
          </li>
        </ul>
      </div>
    </ConfirmDialog>
  );
};

export default WorkstationUnpairConfirmModal;
