import { Check, Save, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import { cn } from "@/utils/cnHelper";
import { teamsFormPanelFooterClassName } from "../teamsStyles";
import type { FormSaveMode } from "./useFormSaveFeedback";

type FormActionButtonsProps = {
  entityLabel: string;
  isCreate: boolean;
  isSaving?: boolean;
  successMode?: FormSaveMode | null;
  onSave: () => void;
  onCancel: () => void;
  /** Whether closing would discard edits. */
  hasPendingChanges?: boolean;
  disabled?: boolean;
  /** Pin Close/Cancel and Save to the bottom of a scrollable form panel. */
  pinFooter?: boolean;
};

const FormActionButtons = ({
  entityLabel,
  isCreate,
  isSaving = false,
  successMode = null,
  onSave,
  onCancel,
  hasPendingChanges = true,
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
        onClick={onCancel}
      >
        {hasPendingChanges ? "Cancel" : "Close"}
      </Button>
      <Button
        variant="cta"
        className="flex-1 justify-center"
        svg={successMode || isSaving ? undefined : Save}
        iconSize="sm"
        aria-busy={isSaving || undefined}
        disabled={disabled}
        onClick={onSave}
      >
        {isSaving ? (
          isCreate ? "Creating…" : "Saving…"
        ) : successMode ? (
          <>
            <Check aria-hidden="true" data-testid="form-save-success-icon" className="size-4 shrink-0" />
            {successMode === "create" ? "Created" : "Saved"}
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
