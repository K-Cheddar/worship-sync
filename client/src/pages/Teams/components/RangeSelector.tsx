import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import Button from "../../../components/Button/Button";
import DateRangePicker from "@/components/ui/DateRangePicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { cn } from "@/utils/cnHelper";
import {
  formatResolvedDateRange,
  RANGE_PRESET_OPTIONS,
  type PlainDateRange,
  type RangePreset,
} from "../rangeSelection";

type RangeSelectorProps = {
  preset: RangePreset;
  range: PlainDateRange;
  summary?: string;
  onPresetChange: (preset: RangePreset) => void;
  onCustomRangeChange: (range: { startDate: string; endDate: string }) => void;
  onNavigate?: (direction: -1 | 1) => void;
  className?: string;
};

/** Shared range vocabulary and responsive control for Services, Forms, and Schedules. */
const RangeSelector = ({
  preset,
  range,
  summary,
  onPresetChange,
  onCustomRangeChange,
  onNavigate,
  className,
}: RangeSelectorProps) => {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const selectedLabel = RANGE_PRESET_OPTIONS.find(
    (option) => option.value === preset,
  )?.label || "Upcoming";
  const showNavigation = Boolean(onNavigate);

  const renderPresetButtons = (mobile = false) => (
    <div
      className={cn(
        mobile ? "flex flex-col gap-1" : "flex flex-wrap gap-1.5",
      )}
      role="group"
      aria-label="Date range presets"
    >
      {RANGE_PRESET_OPTIONS.map((option) => {
        const selected = preset === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            variant="tertiary"
            isSelected={selected}
            aria-pressed={selected}
            aria-label={option.label}
            className={cn(
              mobile ? "w-full text-left text-sm max-md:min-h-0 max-md:px-2 max-md:py-1.5" : "text-xs",
              selected && "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
            )}
            onClick={() => {
              onPresetChange(option.value);
              if (mobile) setPopoverOpen(false);
            }}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="px-0.5 text-sm font-semibold">Range</span>
      {isDesktop ? (
        renderPresetButtons()
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
            {renderPresetButtons(true)}
          </PopoverContent>
        </Popover>
      )}
      <div className="flex min-w-0 items-center gap-1">
        {showNavigation ? (
          <Button
            type="button"
            variant="tertiary"
            svg={ChevronLeft}
            aria-label="Previous period"
            onClick={() => onNavigate?.(-1)}
            className="shrink-0 max-md:min-h-0"
          />
        ) : null}
        <p className="min-w-0 px-0.5 text-xs text-gray-400" aria-live="polite">
          {formatResolvedDateRange(range)}
          {summary ? ` · ${summary}` : null}
        </p>
        {showNavigation ? (
          <Button
            type="button"
            variant="tertiary"
            svg={ChevronRight}
            aria-label="Next period"
            onClick={() => onNavigate?.(1)}
            className="shrink-0 max-md:min-h-0"
          />
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

export default RangeSelector;
