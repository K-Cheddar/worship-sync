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
  labelLayout?: "stacked" | "inline";
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
  labelLayout = "stacked",
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
    <div
      className={cn(
        "min-w-0",
        labelLayout === "inline" ? "flex items-start gap-2" : "flex flex-col gap-1.5",
        className,
      )}
    >
      <span className={cn("px-0.5 text-sm font-semibold", labelLayout === "inline" && "shrink-0 pt-1")}>
        Range
      </span>
      <div className={cn("flex min-w-0 flex-col gap-1.5", labelLayout === "inline" && "flex-1")}>
        {isDesktop ? (
          renderPresetButtons()
        ) : (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="tertiary"
                aria-label={`Range preset: ${selectedLabel}`}
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
          {preset === "custom" ? (
            <DateRangePicker
              label="Date range"
              aria-label="Custom date range"
              hideLabel
              className="min-w-0 w-full lg:w-56 lg:shrink-0"
              inputClassName="h-8 min-h-8 w-full max-w-full min-w-0 border-gray-700 bg-gray-800/70 px-2 pr-8 text-xs shadow-none"
              value={{ startDate: range.start, endDate: range.end }}
              onChange={onCustomRangeChange}
            />
          ) : (
            <p className="min-w-0 px-0.5 text-xs text-gray-400" aria-live="polite">
              {formatResolvedDateRange(range)}
              {summary ? ` · ${summary}` : null}
            </p>
          )}
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
      </div>
    </div>
  );
};

export default RangeSelector;
