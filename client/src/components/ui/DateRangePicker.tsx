"use client";

import * as React from "react";
import { format } from "date-fns";
import type { DateRange, Matcher } from "react-day-picker";
import { CalendarDays } from "lucide-react";

import { cn } from "@/utils/cnHelper";
import Label from "@/components/ui/Label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import Calendar from "@/components/ui/Calendar";
import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";

export type DateRangeValue = {
  /** Plain calendar date string, `yyyy-MM-dd` (no timezone). */
  startDate: string;
  endDate: string;
};

export type DateRangePickerProps = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Earliest selectable date, `yyyy-MM-dd`. */
  min?: string;
  /** Latest selectable date, `yyyy-MM-dd`. */
  max?: string;
  className?: string;
  inputClassName?: string;
  /** Falls back to `label` when omitted. */
  "aria-label"?: string;
  id?: string;
};

/** Display format for each endpoint. */
const DISPLAY_FORMAT = "MM/dd/yyyy";

const displayRange = (value: DateRangeValue) => {
  const from = parsePlainDate(value.startDate);
  const to = parsePlainDate(value.endDate);
  if (!from && !to) return "";
  const fromText = from ? format(from, DISPLAY_FORMAT) : "…";
  const toText = to ? format(to, DISPLAY_FORMAT) : "…";
  return `${fromText} – ${toText}`;
};

/**
 * Range counterpart to `DatePicker`: one input and one calendar where the user
 * clicks a start then an end. Values are plain `yyyy-MM-dd` strings. The field
 * is read-only (click to open the calendar) since typing a range is fiddly.
 */
const DateRangePicker = ({
  value,
  onChange,
  label,
  hideLabel = false,
  placeholder = "MM/DD/YYYY – MM/DD/YYYY",
  disabled = false,
  min,
  max,
  className,
  inputClassName,
  "aria-label": ariaLabel,
  id,
}: DateRangePickerProps) => {
  const [open, setOpen] = React.useState(false);
  const generatedId = React.useId();
  const fieldId = id || generatedId;

  const from = parsePlainDate(value.startDate);
  const to = parsePlainDate(value.endDate);
  const minDate = min ? parsePlainDate(min) : undefined;
  const maxDate = max ? parsePlainDate(max) : undefined;
  const selected: DateRange | undefined = from
    ? { from, to: to || undefined }
    : undefined;
  const text = displayRange(value);

  const disabledMatchers: Matcher[] = [];
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  return (
    <div className={cn("group relative h-fit", className)}>
      {label ? (
        <Label
          htmlFor={fieldId}
          className={cn(
            "block p-1 text-sm font-semibold text-white",
            hideLabel && "sr-only",
          )}
        >
          {label}:
        </Label>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <PopoverTrigger asChild>
              <button
                id={fieldId}
                type="button"
                disabled={disabled}
                aria-label={ariaLabel || label}
                className={cn(
                  "box-border flex min-h-9 w-full min-w-0 items-center rounded-md border border-neutral-500 bg-neutral-900 py-1 pl-2 pr-9 text-left text-sm text-neutral-100 shadow-none outline-none transition-[color,box-shadow]",
                  "focus-visible:border-cyan-500/80 focus-visible:ring-[3px] focus-visible:ring-cyan-500/35",
                  disabled && "pointer-events-none cursor-not-allowed opacity-50",
                  inputClassName,
                )}
              >
                <span className={cn(!text && "text-neutral-400")}>
                  {text || placeholder}
                </span>
              </button>
            </PopoverTrigger>
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-neutral-400"
            >
              <CalendarDays className="h-4 w-4" />
            </span>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-auto rounded-md border border-gray-700 bg-gray-900 p-0 shadow-xl"
        >
          <Calendar
            mode="range"
            selected={selected}
            defaultMonth={from || minDate}
            startMonth={minDate}
            endMonth={maxDate}
            disabled={disabledMatchers.length ? disabledMatchers : undefined}
            onSelect={(range) => {
              onChange({
                startDate: range?.from ? formatPlainDate(range.from) : "",
                endDate: range?.to ? formatPlainDate(range.to) : "",
              });
              if (range?.from && range?.to) setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default DateRangePicker;
