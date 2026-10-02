import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Button from "../../../components/Button/Button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { cn } from "@/utils/cnHelper";
import type { TeamScheduleSummary } from "../../../api/authTypes";
import { parsePlainDate } from "@/utils/plainDate";

const formatPersistedRange = (startDate: string, endDate: string) => {
  const start = parsePlainDate(startDate);
  const end = parsePlainDate(endDate);
  if (!start || !end) return `${startDate} – ${endDate}`;
  const format = (date: Date) => date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return startDate === endDate ? format(start) : `${format(start)} – ${format(end)}`;
};

const ScheduleOverlapPicker = ({
  schedules,
  selectedScheduleId,
  onSelect,
}: {
  schedules: TeamScheduleSummary[];
  selectedScheduleId: string;
  onSelect: (scheduleId: string) => void;
}) => {
  const selected = schedules.find((schedule) => schedule.scheduleId === selectedScheduleId);
  const [open, setOpen] = useState(false);
  if (schedules.length < 2 || !selected) return null;

  return (
    <div className="flex min-w-0 max-w-56 items-center gap-2">
      <span className="shrink-0 px-0.5 text-sm font-semibold">Schedule:</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="tertiary"
            aria-label={`Schedule: ${selected.name}`}
            aria-haspopup="dialog"
            className="min-w-0 max-w-44 justify-between gap-2 bg-gray-800/80 text-left text-xs"
          >
            <span className="truncate">{selected.name}</span>
            <ChevronDown className="size-4 shrink-0 text-gray-300" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 border-gray-700 bg-gray-900 p-1.5 text-gray-100">
          <div role="group" aria-label="Overlapping schedules" className="scrollbar-portal max-h-64 overflow-y-auto">
            {schedules.map((schedule) => {
              const isSelected = schedule.scheduleId === selectedScheduleId;
              const rangeLabel = schedule.startDate && schedule.endDate
                ? formatPersistedRange(schedule.startDate, schedule.endDate)
                : "No dates set";
              const description = schedule.scheduleId.startsWith("virtual:")
                ? `Current period · ${rangeLabel}`
                : rangeLabel;
              return (
                <button
                  key={schedule.scheduleId}
                  type="button"
                  aria-pressed={isSelected}
                  className={cn(
                    "flex w-full cursor-pointer flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-gray-800",
                    isSelected && "bg-cyan-950/50",
                  )}
                  onClick={() => {
                    onSelect(schedule.scheduleId);
                    setOpen(false);
                  }}
                >
                  <span className="w-full truncate text-sm text-gray-100">{schedule.name}</span>
                  <span className="text-xs text-gray-400">{description}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default ScheduleOverlapPicker;
