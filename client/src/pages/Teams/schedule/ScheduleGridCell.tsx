import { memo, useCallback, useContext, useMemo } from "react";
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
import ScheduleAssignmentCell from "./ScheduleAssignmentCell";
import ScheduleShadowChip from "./ScheduleShadowChip";
import { ScheduleAssignmentContext } from "./ScheduleAssignmentContext";
import {
  scheduleCellPaddingClassName,
  scheduleGridLeftBorderClassName,
} from "./scheduleUtils";

type ScheduleGridCellProps = {
  occurrenceId: string;
  occurrenceName: string;
  columnKey: string;
  positionId: string;
  columnLabel: string;
  rowTone: string;
  slot: number;
  requiredCount: number;
  axisHighlightClassName: string;
  assignmentCell?: TeamScheduleCellAssignment;
  isMemberHighlighted: boolean;
  isActiveSlot: boolean;
  allMembers: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  canEdit: boolean;
};

const ScheduleGridCell = memo(({
  occurrenceId,
  occurrenceName,
  columnKey,
  positionId,
  columnLabel,
  rowTone,
  slot,
  requiredCount,
  axisHighlightClassName,
  assignmentCell,
  isMemberHighlighted,
  isActiveSlot,
  allMembers,
  duplicateFirstNames,
  canEdit,
}: ScheduleGridCellProps) => {
  const handlersRef = useContext(ScheduleAssignmentContext);
  const assignedMemberId = getCellPrimaryMemberId(assignmentCell);
  const shadowAssignments = getCellShadowAssignments(assignmentCell);
  const assignedMember = allMembers.find(
    (item) => item.memberId === assignedMemberId,
  );

  const cellLabel = useMemo(
    () => `${occurrenceName} ${columnLabel}`,
    [columnLabel, occurrenceName],
  );

  const displayLabel = assignedMember
    ? scheduleMemberName(assignedMember, duplicateFirstNames)
    : "Empty";

  const handleActivate = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      handlersRef?.current?.activateSlot(
        { occurrenceId, columnKey },
        event.currentTarget,
      );
    },
    [handlersRef, occurrenceId, columnKey],
  );

  if (slot >= requiredCount) {
    return (
      <td
        className={cn(
          "text-center align-middle text-gray-600",
          scheduleGridLeftBorderClassName,
          scheduleCellPaddingClassName,
          rowTone,
          axisHighlightClassName,
        )}
        aria-label={`${columnLabel} not needed for this service`}
      >
        <span aria-hidden>—</span>
      </td>
    );
  }

  return (
    <ScheduleAssignmentCell
      rowTone={rowTone}
      highlighted={isMemberHighlighted}
      axisHighlightClassName={axisHighlightClassName}
    >
      <div className="space-y-2">
        <button
          type="button"
          data-schedule-cell-trigger
          data-cell-key={`${occurrenceId}|${columnKey}`}
          aria-haspopup="listbox"
          aria-expanded={isActiveSlot}
          aria-label={`${cellLabel}, ${displayLabel}`}
          disabled={!canEdit}
          className={cn(
            "w-full min-w-0 rounded-lg border px-2 py-1 text-left text-sm text-white focus:border-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
            rowTone ? "border-gray-800 bg-transparent" : "border-gray-800 bg-gray-950",
            isActiveSlot && "border-cyan-400/60 ring-1 ring-cyan-400/40",
            !assignedMember && "text-gray-400 italic",
            !canEdit && "cursor-default",
          )}
          onClick={handleActivate}
        >
          <span className="block truncate">{displayLabel}</span>
        </button>
        {shadowAssignments.length > 0 ? (
          <div className="flex flex-col gap-1">
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
    </ScheduleAssignmentCell>
  );
});
ScheduleGridCell.displayName = "ScheduleGridCell";

export default ScheduleGridCell;
