import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import Button from "../../../components/Button/Button";
import DateRangePicker from "@/components/ui/DateRangePicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { cn } from "@/utils/cnHelper";
import {
  SCHEDULE_PERIOD_OPTIONS,
  type SchedulePeriodPreset,
} from "./schedulePeriodUtils";

export type PeriodRange = { start: string; end: string };

type PeriodRangeFilterProps = {
  preset: SchedulePeriodPreset;
  range: PeriodRange;
  displayRange?: PeriodRange;
  onPresetChange: (preset: SchedulePeriodPreset) => void;
  onCustomRangeChange: (range: { startDate: string; endDate: string }) => void;
  onNavigate?: (direction: -1 | 1) => void;
  className?: string;
};

const formatRangeDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** Shared controlled range vocabulary and responsive control for Teams pages. */
const PeriodRangeFilter = ({
  preset,
  range,
  displayRange = range,
  onPresetChange,
  onCustomRangeChange,
  onNavigate,
  className,
}: PeriodRangeFilterProps) => {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const selectedLabel = SCHEDULE_PERIOD_OPTIONS.find(
    (option) => option.value === preset,
  )?.label;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="px-0.5 text-sm font-semibold">Range</span>
      {isDesktop ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range presets">
          {SCHEDULE_PERIOD_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="tertiary"
              isSelected={preset === option.value}
              className={cn(
                "text-xs",
                preset === option.value &&
                  "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
              )}
              onClick={() => onPresetChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      ) : (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="tertiary"
              aria-label="Date range"
              aria-haspopup="dialog"
              className="w-full justify-between bg-gray-800/80 text-left text-xs max-md:min-h-0 max-md:px-2 max-md:py-1"
            >
              <span>{selectedLabel}</span>
              <ChevronDown className="size-4 text-gray-300" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 border-gray-700 bg-gray-900 p-1.5 text-gray-100">
            <div className="flex flex-col gap-1" role="group" aria-label="Date range presets">
              {SCHEDULE_PERIOD_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant="tertiary"
                  isSelected={preset === option.value}
                  className={cn(
                    "w-full text-left text-sm max-md:min-h-0 max-md:px-2 max-md:py-1.5",
                    preset === option.value && "bg-cyan-950/40 text-cyan-100",
                  )}
                  onClick={() => {
                    onPresetChange(option.value);
                    setPopoverOpen(false);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      <div className="flex items-center gap-1">
        {onNavigate ? (
          <Button type="button" variant="tertiary" svg={ChevronLeft} aria-label="Previous period" onClick={() => onNavigate(-1)} />
        ) : null}
        <p className="min-w-0 flex-1 px-0.5 text-xs text-gray-400">
          {formatRangeDate(displayRange.start)} – {formatRangeDate(displayRange.end)}
        </p>
        {onNavigate ? (
          <Button type="button" variant="tertiary" svg={ChevronRight} aria-label="Next period" onClick={() => onNavigate(1)} />
        ) : null}
      </div>
      {preset === "custom" ? (
        <DateRangePicker
          label="Date range"
          hideLabel
          value={{ startDate: range.start, endDate: range.end }}
          onChange={onCustomRangeChange}
          className="w-full max-w-xs"
          inputClassName="py-1 text-xs"
        />
      ) : null}
    </div>
  );
};

export default PeriodRangeFilter;
