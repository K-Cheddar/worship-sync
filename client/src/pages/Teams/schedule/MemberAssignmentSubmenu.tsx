import type { MouseEvent } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/utils/cnHelper";

export type MemberAssignmentActionIssues = {
  replace: string;
  shadow: string;
  reverseShadow: string;
};

type AssignmentActionItem = {
  label: string;
  issue: string;
  onSelect: () => void;
};

export const sortMemberAssignmentActionItems = <T extends { issue: string }>(
  items: T[],
) => {
  const available = items.filter((item) => !item.issue);
  const unavailable = items.filter((item) => item.issue);
  return [...available, ...unavailable];
};

export const shouldShowMemberAssignmentActionGroupDivider = <T extends { issue: string }>(
  items: T[],
  index: number,
) => index > 0 && !items[index - 1].issue && Boolean(items[index].issue);

type MemberAssignmentSubmenuProps = {
  title: string;
  issues: MemberAssignmentActionIssues;
  onReplace: () => void;
  onAddShadow: () => void;
  onAddReverseShadow: () => void;
  onBack?: () => void;
  className?: string;
};

const runAction = (action: () => void, disabled: boolean) => (event: MouseEvent) => {
  event.preventDefault();
  if (disabled) return;
  action();
};

const SubmenuButton = ({
  label,
  issue,
  onSelect,
}: {
  label: string;
  issue: string;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role="menuitem"
    disabled={Boolean(issue)}
    className="flex w-full flex-col rounded px-2 py-1.5 text-left text-sm font-medium text-gray-100 hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-500"
    onMouseDown={runAction(onSelect, Boolean(issue))}
  >
    <span className="block">{label}</span>
    {issue ? <span className="text-xs text-gray-500">{issue}</span> : null}
  </button>
);

const MemberAssignmentSubmenu = ({
  title,
  issues,
  onReplace,
  onAddShadow,
  onAddReverseShadow,
  onBack,
  className,
}: MemberAssignmentSubmenuProps) => {
  const actionItems = sortMemberAssignmentActionItems<AssignmentActionItem>([
    { label: "Replace member", issue: issues.replace, onSelect: onReplace },
    { label: "Add as shadow", issue: issues.shadow, onSelect: onAddShadow },
    {
      label: "Add as reverse shadow",
      issue: issues.reverseShadow,
      onSelect: onAddReverseShadow,
    },
  ]);

  return (
    <div role="menu" className={cn("p-1", className)}>
      {onBack ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-medium text-gray-100 hover:bg-gray-800"
            onMouseDown={runAction(onBack, false)}
          >
            <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
            Back
          </button>
          <div className="my-1 h-px bg-gray-700" role="separator" />
        </>
      ) : null}
      <p className="px-2 py-1.5 text-xs font-normal text-gray-400">{title}</p>
      {actionItems.map((item, index) => (
        <div key={item.label}>
          {shouldShowMemberAssignmentActionGroupDivider(actionItems, index) ? (
            <div className="my-1 h-px bg-gray-700" role="separator" />
          ) : null}
          <SubmenuButton
            label={item.label}
            issue={item.issue}
            onSelect={item.onSelect}
          />
        </div>
      ))}
    </div>
  );
};

export default MemberAssignmentSubmenu;
