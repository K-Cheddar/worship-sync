import { memo, type ReactNode } from "react";
import { cn } from "@/utils/cnHelper";
import {
  scheduleCellPaddingClassName,
  scheduleGridLeftBorderClassName,
  schedulePositionColumnClassName,
} from "./scheduleUtils";

type ScheduleAssignmentCellProps = {
  children: ReactNode;
  rowTone?: string;
  highlighted?: boolean;
  axisHighlightClassName?: string;
};

const ScheduleAssignmentCell = memo(({
  children,
  rowTone,
  highlighted = false,
  axisHighlightClassName,
}: ScheduleAssignmentCellProps) => {
  return (
    <td
      className={cn(
        schedulePositionColumnClassName,
        scheduleCellPaddingClassName,
        "align-middle",
        scheduleGridLeftBorderClassName,
        rowTone,
        axisHighlightClassName,
        highlighted && "bg-amber-400/15 outline outline-amber-300/50",
      )}
    >
      {children}
    </td>
  );
});
ScheduleAssignmentCell.displayName = "ScheduleAssignmentCell";

export default ScheduleAssignmentCell;
