import { ChevronDown } from "lucide-react";
import Button from "../Button/Button";
import { cn } from "@/utils/cnHelper";

export type CollapsibleSectionTriggerProps = {
  label: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  className?: string;
};

/**
 * Full-width labeled control for expanding/collapsing a section (chevron rotates when collapsed).
 */
const CollapsibleSectionTrigger = ({
  label,
  expanded,
  onExpandedChange,
  className,
}: CollapsibleSectionTriggerProps) => (
  <Button
    type="button"
    variant="none"
    padding="p-1"
    className={cn(
      "w-full justify-start gap-1.5 text-left text-sm font-semibold text-gray-100 max-md:min-h-0 min-h-0",
      className,
    )}
    aria-expanded={expanded}
    onClick={() => onExpandedChange(!expanded)}
  >
    <ChevronDown
      className={cn(
        "h-4 w-4 shrink-0 text-gray-400 transition-transform",
        expanded ? "rotate-0" : "-rotate-90",
      )}
      aria-hidden
    />
    <span>{label}</span>
  </Button>
);

export default CollapsibleSectionTrigger;
