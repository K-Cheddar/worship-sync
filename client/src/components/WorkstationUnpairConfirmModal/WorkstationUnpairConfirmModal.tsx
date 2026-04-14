import Modal from "../Modal/Modal";
import Button from "../Button/Button";

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
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Unlink this computer?"
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
      <div className="mt-6 flex w-full gap-3">
        <Button
          className="flex-1 justify-center"
          type="button"
          variant="tertiary"
          onClick={handleClose}
          disabled={isConfirming}
        >
          Cancel
        </Button>
        <Button
          className="flex-1 justify-center"
          type="button"
          variant="destructive"
          onClick={() => void onConfirm()}
          disabled={isConfirming}
          isLoading={isConfirming}
        >
          Unlink
        </Button>
      </div>
    </Modal>
  );
};

export default WorkstationUnpairConfirmModal;
