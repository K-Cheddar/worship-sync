import DeleteModal from "../../../components/Modal/DeleteModal";
import { useAccountPage } from "../AccountPageContext";

const AccountDeleteModalHost = () => {
  const {
    destructiveConfirm,
    destructiveConfirmRunning,
    destructiveModalProps,
    handleDestructiveConfirm,
    setDestructiveConfirm,
  } = useAccountPage();

  return (
    <DeleteModal
      isOpen={destructiveConfirm !== null}
      onClose={() => setDestructiveConfirm(null)}
      onConfirm={() => void handleDestructiveConfirm()}
      isConfirming={destructiveConfirmRunning}
      confirmingLabel="Applying..."
      cancelText="Cancel"
      {...(destructiveModalProps ?? {
        title: "",
        message: "",
      })}
    />
  );
};

export default AccountDeleteModalHost;
