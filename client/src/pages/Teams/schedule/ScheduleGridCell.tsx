import { memo, useCallback, useContext, useMemo } from "react";
import { X } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import Button from "@/components/Button/Button";
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
  isSlotEnabled: boolean;
  isAdditionalPosition: boolean;
  axisHighlightClassName: string;
  assignmentCell?: TeamScheduleCellAssignment;
  isMemberHighlighted: boolean;
  isActiveSlot: boolean;
  justFilled?: boolean;
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
  isSlotEnabled,
  isAdditionalPosition,
  axisHighlightClassName,
  assignmentCell,
  isMemberHighlighted,
  isActiveSlot,
  justFilled = false,
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

  const handleRemove = useCallback(() => {
    handlersRef?.current?.requestRemoveAdditionalPosition({
      serviceId: occurrenceId,
      cellKey: columnKey,
    });
  }, [columnKey, handlersRef, occurrenceId]);

  if (!isSlotEnabled) {
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
      justFilled={justFilled}
      axisHighlightClassName={axisHighlightClassName}
    >
      <div className="space-y-2">
        {/* Keep remove as a compact × — grid columns are too narrow for a
            full "Remove position" label, and overflow clipping hid the old text. */}
        <div className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            data-schedule-cell-trigger
            data-cell-key={`${occurrenceId}|${columnKey}`}
            aria-haspopup="listbox"
            aria-expanded={isActiveSlot}
            aria-label={`${cellLabel}, ${displayLabel}`}
            disabled={!canEdit}
            className={cn(
              "min-w-0 flex-1 rounded-lg border px-2 py-1 text-left text-sm text-white focus:border-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
              rowTone ? "border-gray-800 bg-transparent" : "border-gray-800 bg-gray-950",
              isActiveSlot && "border-cyan-400/60 ring-1 ring-cyan-400/40",
              !assignedMember && "text-gray-400 italic",
              !canEdit && "cursor-default",
            )}
            onClick={handleActivate}
          >
            <span className="block truncate">{displayLabel}</span>
          </button>
          {canEdit && isAdditionalPosition ? (
            <Button
              type="button"
              variant="tertiary"
              svg={X}
              iconSize="sm"
              padding="p-0.5"
              aria-label={`Remove ${columnLabel} from this date`}
              className="shrink-0 text-gray-400 hover:text-red-200"
              onClick={handleRemove}
            />
          ) : null}
        </div>
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
