import { Check, Save, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import { cn } from "@/utils/cnHelper";
import { teamsFormPanelFooterClassName } from "../teamsStyles";

type FormActionButtonsProps = {
  entityLabel: string;
  isCreate: boolean;
  isSaving?: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Whether closing would discard edits. */
  hasPendingChanges?: boolean;
  /** Whether the primary save action has fields to commit. */
  hasPendingSaveChanges?: boolean;
  disabled?: boolean;
  /** Pin Close/Cancel and Save to the bottom of a scrollable form panel. */
  pinFooter?: boolean;
};

const FormActionButtons = ({
  entityLabel,
  isCreate,
  isSaving = false,
  onSave,
  onCancel,
  hasPendingChanges = true,
  hasPendingSaveChanges = hasPendingChanges,
  disabled = false,
  pinFooter = false,
}: FormActionButtonsProps) => (
  <div className={cn(pinFooter && teamsFormPanelFooterClassName)}>
    <div className="flex gap-3">
      <Button
        variant="secondary"
        className="flex-1 justify-center"
        svg={X}
        iconSize="sm"
        disabled={isSaving}
        onClick={onCancel}
      >
        {hasPendingChanges ? "Cancel" : "Close"}
      </Button>
      <Button
        variant="cta"
        className="flex-1 justify-center"
        svg={isSaving || (!isCreate && !hasPendingSaveChanges) ? undefined : Save}
        iconSize="sm"
        aria-busy={isSaving || undefined}
        disabled={disabled || isSaving || (!isCreate && !hasPendingSaveChanges)}
        onClick={onSave}
      >
        {isSaving ? (
          isCreate ? "Creating…" : "Saving…"
        ) : !isCreate && !hasPendingSaveChanges ? (
          <>
            <Check aria-hidden="true" data-testid="form-save-success-icon" className="size-4 shrink-0 text-emerald-300" />
            Saved
          </>
        ) : isCreate ? (
          `Create ${entityLabel}`
        ) : (
          `Save ${entityLabel}`
        )}
      </Button>
    </div>
  </div>
);

export default FormActionButtons;
