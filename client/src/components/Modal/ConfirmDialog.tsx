import type { ComponentProps, ReactNode } from "react";
import Modal from "./Modal";
import Button from "../Button/Button";

type ConfirmDialogProps = Omit<ComponentProps<typeof Modal>, "isOpen" | "onClose" | "children"> & {
  open: boolean;
  description?: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  actionsClassName?: string;
  cancelVariant?: ComponentProps<typeof Button>["variant"];
};

const ConfirmDialog = ({
  open, onConfirm, onCancel, confirmLabel, cancelLabel = "Cancel",
  destructive = false, busy = false, children, description,
  size = "sm", actionsClassName = "mt-6 flex w-full gap-3",
  cancelVariant = "secondary", ...props
}: ConfirmDialogProps) => (
  <Modal {...props} isOpen={open} onClose={onCancel} description={description} size={size} busy={busy}>
    {children ?? <p className="text-sm text-gray-200">{description}</p>}
    <div className={actionsClassName}>
      <Button className="flex-1 justify-center" variant={cancelVariant} onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
      <Button className="flex-1 justify-center" variant={destructive ? "destructive" : "primary"} onClick={onConfirm} disabled={busy} isLoading={busy}>{confirmLabel}</Button>
    </div>
  </Modal>
);

export default ConfirmDialog;
