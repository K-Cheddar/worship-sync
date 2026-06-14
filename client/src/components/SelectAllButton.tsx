import Button from "./Button/Button";
import { cn } from "@/utils/cnHelper";

export type SelectAllButtonTone = "admin" | "board-attendee";

type SelectAllButtonProps = {
  allSelected: boolean;
  onClick: () => void;
  selectLabel?: string;
  clearLabel?: string;
  tone?: SelectAllButtonTone;
  className?: string;
  disabled?: boolean;
};

const toneClassNames: Record<SelectAllButtonTone, string> = {
  admin: "text-xs text-cyan-300 hover:text-cyan-200",
  "board-attendee": "text-xs text-amber-300 hover:text-amber-200",
};

const SelectAllButton = ({
  allSelected,
  onClick,
  selectLabel = "Select all",
  clearLabel = "Clear all",
  tone = "admin",
  className,
  disabled = false,
}: SelectAllButtonProps) => (
  <Button
    type="button"
    variant="textLink"
    disabled={disabled}
    className={cn(toneClassNames[tone], "shrink-0", className)}
    onClick={onClick}
  >
    {allSelected ? clearLabel : selectLabel}
  </Button>
);

export default SelectAllButton;
