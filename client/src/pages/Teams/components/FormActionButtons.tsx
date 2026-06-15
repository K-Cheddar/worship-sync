import { Save, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import { cn } from "@/utils/cnHelper";
import { teamsFormPanelFooterClassName } from "../teamsStyles";

type FormActionButtonsProps = {
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  /** Pin Cancel/Save to the bottom of a scrollable form panel. */
  pinFooter?: boolean;
};

const FormActionButtons = ({
  saveLabel,
  onSave,
  onCancel,
  disabled = false,
  isLoading = false,
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
        Cancel
      </Button>
      <Button
        variant="cta"
        className="flex-1 justify-center"
        svg={Save}
        iconSize="sm"
        disabled={disabled}
        isLoading={isLoading}
        onClick={onSave}
      >
        {saveLabel}
      </Button>
    </div>
  </div>
);

export default FormActionButtons;
