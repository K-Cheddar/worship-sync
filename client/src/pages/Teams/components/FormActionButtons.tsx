import { Save, X } from "lucide-react";
import Button from "../../../components/Button/Button";

type FormActionButtonsProps = {
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
  isLoading?: boolean;
};

const FormActionButtons = ({
  saveLabel,
  onSave,
  onCancel,
  disabled = false,
  isLoading = false,
}: FormActionButtonsProps) => (
  <div className="flex gap-2">
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
);

export default FormActionButtons;
