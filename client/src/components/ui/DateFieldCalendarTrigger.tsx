import { CalendarDays } from "lucide-react";

import { cn } from "@/utils/cnHelper";
import { PopoverTrigger } from "@/components/ui/Popover";

type DateFieldCalendarTriggerProps = {
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
};

const DateFieldCalendarTrigger = ({
  disabled = false,
  "aria-label": ariaLabel = "Open calendar",
  className,
}: DateFieldCalendarTriggerProps) => (
  <PopoverTrigger asChild>
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:pointer-events-none",
        className,
      )}
    >
      <CalendarDays className="h-4 w-4" aria-hidden />
    </button>
  </PopoverTrigger>
);

export default DateFieldCalendarTrigger;
