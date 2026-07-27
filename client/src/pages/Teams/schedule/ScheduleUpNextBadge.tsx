import { CalendarClock } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import { scheduleUpNextBorderClassName } from "./scheduleUtils";

/**
 * "Up next" marker for the soonest upcoming service, shown the same way on every
 * schedule layout. Orange to match the up-next border on the board card; on the
 * board it is positioned absolutely at the top of the card, in the grids it sits
 * inline above the date.
 */
const ScheduleUpNextBadge = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-full border bg-orange-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-200 shadow-sm",
      scheduleUpNextBorderClassName,
      className,
    )}
  >
    <CalendarClock className="h-3 w-3 shrink-0 text-orange-300" aria-hidden />
    Up next
  </span>
);

export default ScheduleUpNextBadge;
