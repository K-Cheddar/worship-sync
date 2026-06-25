"use client";

import * as React from "react";
import { isSameDay } from "date-fns";
import type { DateRange, Matcher } from "react-day-picker";

import { cn } from "@/utils/cnHelper";
import Input from "@/components/ui/Input";
import Label from "@/components/ui/Label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/Popover";
import Calendar from "@/components/ui/Calendar";
import DateFieldCalendarTrigger from "@/components/ui/DateFieldCalendarTrigger";
import {
  DATE_PICKER_POPOVER_KEYSHORTCUT,
  DATE_PICKER_POPOVER_CONTENT_CLASS,
  openCalendarOnAltArrowDown,
} from "@/components/ui/datePickerAccessibility";
import { parsePlainDate } from "@/utils/plainDate";
import {
  useSegmentedDateRangeInput,
  type DateRangeValue,
} from "@/hooks/useSegmentedDateRangeInput";

export type { DateRangeValue };

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

/**
 * Range counterpart to `DatePicker`: one segmented input and one calendar where
 * the user clicks a start then an end. Values are plain `yyyy-MM-dd` strings.
 *
 * Uses `resetOnSelect` so the first click only sets the start; a second click
 * completes the range (including the same day for single-day windows).
 */
const isCompleteRange = (range: DateRange | undefined) =>
  Boolean(range?.from && range?.to);

const resolveRangeSelection = (
  prior: DateRange | undefined,
  next: DateRange | undefined,
  selectedDay: Date,
): DateRange | undefined => {
  if (
    prior?.from &&
    !prior.to &&
    isSameDay(prior.from, selectedDay) &&
    !next?.to
  ) {
    return { from: prior.from, to: selectedDay };
  }
  return next;
};

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
  const minDate = min ? parsePlainDate(min) : undefined;
  const maxDate = max ? parsePlainDate(max) : undefined;

  const {
    inputRef,
    inputValue,
    selectedRange,
    calendarMonth,
    setCalendarMonth,
    handleKeyDown,
    handleFocus,
    handleMouseUp,
    handleBlur,
    applyCalendarRange,
  } = useSegmentedDateRangeInput({ value, onChange });

  const disabledMatchers: Matcher[] = [];
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  const handleSelect = (
    range: DateRange | undefined,
    selectedDay: Date,
  ) => {
    const resolved = resolveRangeSelection(selectedRange, range, selectedDay);
    applyCalendarRange(resolved);
    if (isCompleteRange(resolved)) {
      setOpen(false);
    }
  };

  const openCalendar = () => {
    if (!disabled) setOpen(true);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (openCalendarOnAltArrowDown(event, openCalendar, disabled)) return;
    handleKeyDown(event);
  };

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
            <Input
              id={fieldId}
              ref={inputRef}
              type="text"
              inputMode="numeric"
              disabled={disabled}
              readOnly
              aria-label={ariaLabel || label}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-keyshortcuts={DATE_PICKER_POPOVER_KEYSHORTCUT}
              placeholder={placeholder}
              value={inputValue}
              className={cn(
                "py-1 pl-2 pr-9 text-sm shadow-none",
                disabled && "cursor-not-allowed",
                inputClassName,
              )}
              onChange={() => { }}
              onClick={openCalendar}
              onKeyDown={handleInputKeyDown}
              onFocus={handleFocus}
              onMouseUp={handleMouseUp}
              onBlur={handleBlur}
            />
            <DateFieldCalendarTrigger
              disabled={disabled}
              aria-label="Open date range calendar"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className={DATE_PICKER_POPOVER_CONTENT_CLASS}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Calendar
            mode="range"
            resetOnSelect
            selected={selectedRange}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            defaultMonth={selectedRange?.from || minDate}
            startMonth={minDate}
            endMonth={maxDate}
            disabled={disabledMatchers.length ? disabledMatchers : undefined}
            excludeDisabled={disabledMatchers.length > 0}
            onSelect={handleSelect}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default DateRangePicker;
