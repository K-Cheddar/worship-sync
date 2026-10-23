import { CalendarClock } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import { scheduleUpNextBorderClassName } from "./priorityStyles";

/** Up next marker shared by the schedule board and service cards. */
const ScheduleUpNextBadge = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-orange-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-200 shadow-sm",
      scheduleUpNextBorderClassName,
      className,
    )}
  >
    <CalendarClock className="h-3 w-3 shrink-0 text-orange-300" aria-hidden />
    Up next
  </span>
);

export default ScheduleUpNextBadge;
