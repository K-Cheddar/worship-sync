import { ChevronDown } from "lucide-react";
import cn from "classnames";
import Button from "../Button/Button";

export type ExpandCollapseChevronButtonProps = {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  expandLabel: string;
  collapseLabel: string;
  className?: string;
};

/**
 * Icon-only control for expanding/collapsing a row or panel (rotated chevron when collapsed).
 */
const ExpandCollapseChevronButton = ({
  expanded,
  onExpandedChange,
  expandLabel,
  collapseLabel,
  className,
}: ExpandCollapseChevronButtonProps) => (
  <Button
    type="button"
    variant="tertiary"
    padding="p-0.5"
    className={cn(
      "mt-0.5 shrink-0 rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200 max-md:min-h-0 min-h-0",
      className,
    )}
    aria-expanded={expanded}
    aria-label={expanded ? collapseLabel : expandLabel}
    onClick={() => onExpandedChange(!expanded)}
  >
    <ChevronDown
      className={cn(
        "size-5 transition-transform",
        expanded ? "rotate-0" : "-rotate-90",
      )}
    />
  </Button>
);

export default ExpandCollapseChevronButton;
