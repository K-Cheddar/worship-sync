import { CalendarDays } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import { scheduleTodayBorderClassName } from "./scheduleUtils";

/**
 * "Today" marker for services that fall on the current calendar day. Sky to
 * contrast with the orange "Up next" badge; same absolute placement on board
 * cards and plans tiles, inline above the date in grids.
 */
const ScheduleTodayBadge = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-sky-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200 shadow-sm",
      scheduleTodayBorderClassName,
      className,
    )}
  >
    <CalendarDays className="h-3 w-3 shrink-0 text-sky-300" aria-hidden />
    Today
  </span>
);

export default ScheduleTodayBadge;
