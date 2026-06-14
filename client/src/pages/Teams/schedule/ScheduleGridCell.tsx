import { memo, useCallback, useContext, useMemo } from "react";
import { X } from "lucide-react";
import Button from "../../../components/Button/Button";
import { cn } from "@/utils/cnHelper";
import type {
  TeamRosterMember,
  TeamScheduleCellAssignment,
} from "../../../api/authTypes";
import {
  getCellPrimaryMemberId,
  getCellShadowAssignments,
  memberName,
  scheduleMemberName,
  shadowKindLabel,
} from "../teamsUtils";
import ScheduleAssignmentCell from "./ScheduleAssignmentCell";
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

  const handleRemoveAssignment = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      void handlersRef?.current?.commitAssignment({
        serviceId: occurrenceId,
        cellKey: columnKey,
        basePositionId: positionId,
        memberId: null,
      });
    },
    [handlersRef, occurrenceId, columnKey, positionId],
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
      <div className="relative space-y-2">
        <div className="flex min-w-0 items-stretch gap-1">
          <button
            type="button"
            data-schedule-cell-trigger
            data-cell-key={`${occurrenceId}|${columnKey}`}
            aria-haspopup="listbox"
            aria-expanded={isActiveSlot}
            aria-label={`${cellLabel}, ${displayLabel}`}
            disabled={!canEdit}
            className={cn(
              "min-w-0 flex-1 rounded-md border px-2 py-1 text-left text-sm text-white focus:border-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
              rowTone ? "border-gray-800 bg-transparent" : "border-gray-800 bg-gray-950",
              isActiveSlot && "border-cyan-400/60 ring-1 ring-cyan-400/40",
              !assignedMember && "text-gray-400 italic",
              !canEdit && "cursor-default",
            )}
            onClick={handleActivate}
          >
            <span className="block truncate">{displayLabel}</span>
          </button>
          {assignedMember && canEdit ? (
            <Button
              type="button"
              variant="tertiary"
              svg={X}
              iconSize="sm"
              padding="p-0"
              className="shrink-0 self-center text-gray-400 hover:text-white"
              aria-label={`Remove ${memberName(assignedMember)} from ${columnLabel}`}
              onClick={handleRemoveAssignment}
            />
          ) : null}
        </div>
        {shadowAssignments.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {shadowAssignments.map((shadow) => {
              const member = allMembers.find(
                (item) => item.memberId === shadow.memberId,
              );
              return (
                <span
                  key={`${shadow.kind}-${shadow.memberId}`}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-amber-300/35 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-50"
                >
                  <span className="truncate">
                    {shadowKindLabel(shadow.kind)}:{" "}
                    {scheduleMemberName(member, duplicateFirstNames)}
                  </span>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="tertiary"
                      svg={X}
                      iconSize="sm"
                      padding="p-0"
                      className="shrink-0 text-amber-100 hover:text-white"
                      aria-label={`Remove ${shadowKindLabel(shadow.kind).toLowerCase()} ${memberName(member)}`}
                      onClick={() =>
                        void handlersRef?.current?.commitShadowAssignment({
                          serviceId: occurrenceId,
                          cellKey: columnKey,
                          basePositionId: positionId,
                          memberId: shadow.memberId,
                          shadowKind: shadow.kind,
                          action: "remove",
                        })
                      }
                    />
                  ) : null}
                </span>
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
