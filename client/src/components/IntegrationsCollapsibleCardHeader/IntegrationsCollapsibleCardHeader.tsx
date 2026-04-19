import type { ReactNode } from "react";
import Button from "../Button/Button";
import ExpandCollapseChevronButton from "../ExpandCollapseChevronButton/ExpandCollapseChevronButton";
import { Trash2 } from "lucide-react";

export type IntegrationsCollapsibleCardHeaderProps = {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  expandLabel: string;
  collapseLabel: string;
  /** Primary label, e.g. “Rule 1”. */
  title: ReactNode;
  /** Summary shown beside the title when collapsed (including “—” when empty). */
  collapsedPreview: string;
  removeAriaLabel: string;
  onRemove: () => void;
};

/**
 * Shared header row for expandable integration cards (rules, people, …).
 */
const IntegrationsCollapsibleCardHeader = ({
  expanded,
  onExpandedChange,
  expandLabel,
  collapseLabel,
  title,
  collapsedPreview,
  removeAriaLabel,
  onRemove,
}: IntegrationsCollapsibleCardHeaderProps) => (
  <div className="flex items-center gap-2">
    <ExpandCollapseChevronButton
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      expandLabel={expandLabel}
      collapseLabel={collapseLabel}
    />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-gray-300">{title}</span>
        {!expanded ? (
          <span
            className="min-w-0 truncate text-xs text-gray-400"
            title={
              collapsedPreview !== "—" ? collapsedPreview : undefined
            }
          >
            {collapsedPreview}
          </span>
        ) : null}
      </div>
    </div>
    <Button
      type="button"
      variant="destructive"
      svg={Trash2}
      iconSize="sm"
      aria-label={removeAriaLabel}
      onClick={onRemove}
    />
  </div>
);

export default IntegrationsCollapsibleCardHeader;
