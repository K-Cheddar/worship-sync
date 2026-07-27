import { memo, useCallback, useContext, useMemo } from "react";
import { User } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import type {
  TeamRosterMember,
  TeamScheduleCellAssignment,
} from "../../../api/authTypes";
import {
  getCellPrimaryMemberId,
  getCellShadowAssignments,
  scheduleMemberName,
} from "../teamsUtils";
import { resolvePositionLucideIcon } from "../lucidePositionIcons";
import ScheduleShadowChip from "./ScheduleShadowChip";
import { ScheduleAssignmentContext } from "./ScheduleAssignmentContext";

type ScheduleBoardCellProps = {
  occurrenceId: string;
  occurrenceName: string;
  columnKey: string;
  positionId: string;
  positionLabel: string;
  positionIcon?: string;
  positionArchived?: boolean;
  assignmentCell?: TeamScheduleCellAssignment;
  isMemberHighlighted: boolean;
  isActiveSlot: boolean;
  allMembers: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  canEdit: boolean;
};

/**
 * One position row inside a per-service board card. Renders the position icon
 * and assignee name but drives the exact same assignment flow as the grid:
 * clicking anchors {@link ScheduleAssignmentPicker} to this row via the shared
 * assignment context.
 */
const ScheduleBoardCell = memo(({
  occurrenceId,
  occurrenceName,
  columnKey,
  positionId,
  positionLabel,
  positionIcon,
  positionArchived = false,
  assignmentCell,
  isMemberHighlighted,
  isActiveSlot,
  allMembers,
  duplicateFirstNames,
  canEdit,
}: ScheduleBoardCellProps) => {
  const handlersRef = useContext(ScheduleAssignmentContext);
  const assignedMemberId = getCellPrimaryMemberId(assignmentCell);
  const shadowAssignments = getCellShadowAssignments(assignmentCell);
  const assignedMember = allMembers.find(
    (item) => item.memberId === assignedMemberId,
  );
  const PositionIcon = useMemo(
    () => resolvePositionLucideIcon(positionIcon),
    [positionIcon],
  );

  const assigneeLabel = assignedMember
    ? scheduleMemberName(assignedMember, duplicateFirstNames)
    : "";

  const handleActivate = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      handlersRef?.current?.activateSlot(
        { occurrenceId, columnKey },
        event.currentTarget,
      );
    },
    [handlersRef, occurrenceId, columnKey],
  );

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-schedule-cell-trigger
        data-cell-key={`${occurrenceId}|${columnKey}`}
        aria-haspopup="listbox"
        aria-expanded={isActiveSlot}
        aria-label={`${occurrenceName} ${positionLabel}, ${assigneeLabel || "empty"}`}
        disabled={!canEdit}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
          isMemberHighlighted && "bg-amber-400/15",
          isActiveSlot && "bg-cyan-400/10 ring-1 ring-cyan-400/40",
          canEdit && !isMemberHighlighted && !isActiveSlot && "hover:bg-gray-900/50",
          !canEdit && "cursor-default",
        )}
        onClick={handleActivate}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-900 text-cyan-200"
          aria-hidden
        >
          {PositionIcon ? <PositionIcon className="h-4 w-4" /> : <User className="h-4 w-4" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 truncate text-xs font-medium text-gray-400">
            {positionLabel}
            {positionArchived ? (
              <span className="shrink-0 font-normal text-gray-500">(archived)</span>
            ) : null}
          </span>
          <span
            className={cn(
              "truncate text-sm font-medium",
              assignedMember ? "text-white" : "text-gray-500 italic",
            )}
          >
            {assigneeLabel || "Unassigned"}
          </span>
        </span>
      </button>
      {shadowAssignments.length > 0 ? (
        <div className="flex flex-col gap-1 pl-11">
          {shadowAssignments.map((shadow) => {
            const member = allMembers.find(
              (item) => item.memberId === shadow.memberId,
            );
            return (
              <ScheduleShadowChip
                key={`${shadow.kind}-${shadow.memberId}`}
                occurrenceId={occurrenceId}
                cellKey={columnKey}
                positionId={positionId}
                shadow={shadow}
                memberName={scheduleMemberName(member, duplicateFirstNames)}
                canEdit={canEdit}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
ScheduleBoardCell.displayName = "ScheduleBoardCell";

export default ScheduleBoardCell;
