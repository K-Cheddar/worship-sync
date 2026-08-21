import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import Button from "../Button/Button";
import { cn } from "@/utils/cnHelper";

export type CollapsibleSectionTriggerProps = {
  label: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  className?: string;
  endContent?: ReactNode;
};

/**
 * Full-width labeled control for expanding/collapsing a section (chevron rotates when collapsed).
 */
const CollapsibleSectionTrigger = ({
  label,
  expanded,
  onExpandedChange,
  className,
  endContent,
}: CollapsibleSectionTriggerProps) => (
  <div className={cn("flex w-full items-center gap-1.5", className)}>
    <Button
      type="button"
      variant="none"
      padding="p-1"
      className="min-h-0 min-w-0 flex-1 justify-start gap-1.5 text-left text-sm font-semibold text-gray-100 max-md:min-h-0"
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
    {expanded ? endContent : null}
  </div>
);

export default CollapsibleSectionTrigger;
