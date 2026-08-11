import { memo, useCallback, useContext, useMemo } from "react";
import { TriangleAlert, X } from "lucide-react";
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
  /** YYYY-MM-DD, for checking the assignee's blockout dates. */
  occurrenceDate: string;
  columnKey: string;
  positionId: string;
  columnLabel: string;
  rowTone: string;
  isSlotEnabled: boolean;
  isAdditionalPosition: boolean;
  axisHighlightClassName: string;
  assignmentCell?: TeamScheduleCellAssignment;
  /** This slot's accept/decline record, if the holder has answered. */
  assignmentResponse?: TeamScheduleAssignmentResponse;
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
  occurrenceDate,
  columnKey,
  positionId,
  columnLabel,
  rowTone,
  isSlotEnabled,
  isAdditionalPosition,
  axisHighlightClassName,
  assignmentCell,
  assignmentResponse,
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
            aria-label={cn(
              `${cellLabel}, ${displayLabel}`,
              blockoutConflictLabel && `, ${blockoutConflictLabel}`,
            )}
            title={blockoutConflictLabel || undefined}
            disabled={!canEdit}
            className={cn(
              "min-w-0 flex-1 rounded-lg border px-2 py-1 text-left text-sm text-white focus:border-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
              rowTone ? "border-gray-800 bg-transparent" : "border-gray-800 bg-gray-950",
              blockoutConflict && "border-amber-500/60 bg-amber-500/10",
              isActiveSlot && "border-cyan-400/60 ring-1 ring-cyan-400/40",
              !assignedMember && "text-gray-400 italic",
              !canEdit && "cursor-default",
            )}
            onClick={handleActivate}
          >
            <span className="flex min-w-0 items-center gap-1">
              {assignedMember ? (
                <ScheduleResponseIndicator
                  response={response}
                  memberName={displayLabel}
                />
              ) : null}
              {blockoutConflict ? (
                <TriangleAlert
                  className="h-3.5 w-3.5 shrink-0 text-amber-300"
                  aria-hidden
                />
              ) : null}
              <span className="block truncate">{displayLabel}</span>
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
