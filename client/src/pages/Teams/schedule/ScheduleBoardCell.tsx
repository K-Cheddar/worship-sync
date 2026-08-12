import { memo, useCallback, useContext, useMemo } from "react";
import { TriangleAlert, User } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import Button from "@/components/Button/Button";
import type {
  TeamRosterMember,
  TeamScheduleCellAssignment,
} from "../../../api/authTypes";
import ScheduleResponseIndicator from "./ScheduleResponseIndicator";
import {
  readAssignmentResponse,
  type TeamScheduleAssignmentResponse,
} from "./scheduleResponseState";
import {
  formatBlockoutDateRangeLabel,
  findBlockoutRangeForDate,
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
  /** YYYY-MM-DD, for checking the assignee's blockout dates. */
  occurrenceDate: string;
  columnKey: string;
  positionId: string;
  positionLabel: string;
  positionIcon?: string;
  positionArchived?: boolean;
  assignmentCell?: TeamScheduleCellAssignment;
  /** This slot's accept/decline record, if the holder has answered. */
  assignmentResponse?: TeamScheduleAssignmentResponse;
  isMemberHighlighted: boolean;
  isActiveSlot: boolean;
  isAdditionalPosition: boolean;
  justFilled?: boolean;
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
  occurrenceDate,
  columnKey,
  positionId,
  positionLabel,
  positionIcon,
  positionArchived = false,
  assignmentCell,
  assignmentResponse,
  isMemberHighlighted,
  isActiveSlot,
  isAdditionalPosition,
  justFilled = false,
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

  // The person in this slot has since blocked the date out. Flagged rather than
  // cleared: only the owner can decide whether to reassign.
  const blockoutConflict = useMemo(
    () =>
      assignedMember
        ? findBlockoutRangeForDate(assignedMember.blockoutDates, occurrenceDate)
        : null,
    [assignedMember, occurrenceDate],
  );
  const blockoutConflictLabel = blockoutConflict
    ? `Blocked out ${formatBlockoutDateRangeLabel(blockoutConflict)}`
    : "";
  const response = readAssignmentResponse(assignmentResponse, assignedMemberId);

  const handleActivate = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      handlersRef?.current?.activateSlot(
        { occurrenceId, columnKey },
        event.currentTarget,
      );
    },
    [handlersRef, occurrenceId, columnKey],
  );

  const handleRemove = useCallback(() => {
    handlersRef?.current?.requestRemoveAdditionalPosition({
      serviceId: occurrenceId,
      cellKey: columnKey,
    });
  }, [columnKey, handlersRef, occurrenceId]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-schedule-cell-trigger
        data-cell-key={`${occurrenceId}|${columnKey}`}
        aria-haspopup="listbox"
        aria-expanded={isActiveSlot}
        aria-label={cn(
          `${occurrenceName} ${positionLabel}, ${assigneeLabel || "empty"}`,
          blockoutConflictLabel && `, ${blockoutConflictLabel}`,
        )}
        disabled={!canEdit}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
          isMemberHighlighted && "bg-amber-400/15",
          isActiveSlot && "bg-cyan-400/10 ring-1 ring-cyan-400/40",
          justFilled && "bg-cyan-400/15",
          canEdit && !isMemberHighlighted && !isActiveSlot && !justFilled && "hover:bg-gray-900/50",
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
              "flex min-w-0 items-center gap-1.5 truncate text-sm font-medium",
              assignedMember ? "text-white" : "text-gray-500 italic",
            )}
          >
            {assignedMember ? (
              <ScheduleResponseIndicator
                response={response}
                memberName={assigneeLabel}
              />
            ) : null}
            <span className="truncate">{assigneeLabel || "Unassigned"}</span>
            {assignedMember?.scheduleGuest ? (
              <span
                className="shrink-0 rounded-full border border-violet-400/40 bg-violet-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-200"
                title="Guest"
                aria-label="Guest"
              >
                G
              </span>
            ) : null}
          </span>
          {blockoutConflictLabel ? (
            <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-300">
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{blockoutConflictLabel}</span>
            </span>
          ) : null}
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
      {canEdit && isAdditionalPosition ? (
        <div className="pl-11">
          <Button
            type="button"
            variant="tertiary"
            className="text-xs text-gray-400 hover:text-red-200"
            onClick={handleRemove}
          >
            Remove position
          </Button>
        </div>
      ) : null}
    </div>
  );
});
ScheduleBoardCell.displayName = "ScheduleBoardCell";

export default ScheduleBoardCell;
