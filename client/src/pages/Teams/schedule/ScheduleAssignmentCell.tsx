import { memo, type ReactNode } from "react";
import { cn } from "@/utils/cnHelper";
import {
  scheduleCellPaddingClassName,
  scheduleAssignmentCellColumnClassName,
  scheduleGridLeftBorderClassName,
  schedulePositionColumnClassName,
} from "./scheduleUtils";

type ScheduleAssignmentCellProps = {
  children: ReactNode;
  rowTone?: string;
  highlighted?: boolean;
  /** Briefly true right after auto-fill places someone here, for a fade-in pulse. */
  justFilled?: boolean;
  axisHighlightClassName?: string;
};

const ScheduleAssignmentCell = memo(({
  children,
  rowTone,
  highlighted = false,
  justFilled = false,
  axisHighlightClassName,
}: ScheduleAssignmentCellProps) => {
  return (
    <td
      className={cn(
        schedulePositionColumnClassName,
        scheduleAssignmentCellColumnClassName,
        scheduleCellPaddingClassName,
        "align-middle transition-colors duration-700",
        scheduleGridLeftBorderClassName,
        rowTone,
        axisHighlightClassName,
        highlighted && "bg-amber-400/15 outline outline-amber-300/50",
        justFilled && "bg-cyan-400/15 outline outline-cyan-300/40",
      )}
    >
      {children}
    </td>
  );
});
ScheduleAssignmentCell.displayName = "ScheduleAssignmentCell";

export default ScheduleAssignmentCell;
