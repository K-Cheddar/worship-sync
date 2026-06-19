"use client";

import * as React from "react";
import type { Matcher } from "react-day-picker";
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
  openCalendarOnAltArrowDown,
} from "@/components/ui/datePickerAccessibility";
import { useSegmentedDateInput } from "@/hooks/useSegmentedDateInput";
import { parsePlainDate } from "@/utils/plainDate";

export type DatePickerProps = {
  /** Value is a plain calendar date string, `yyyy-MM-dd` (no timezone). */
  value: string;
  onChange: (value: string) => void;
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

const DatePicker = ({
  value,
  onChange,
  label,
  hideLabel = false,
  placeholder = "MM/DD/YYYY",
  disabled = false,
  min,
  max,
  className,
  inputClassName,
  "aria-label": ariaLabel,
  id,
}: DatePickerProps) => {
  const [open, setOpen] = React.useState(false);
  const generatedId = React.useId();
  const fieldId = id || generatedId;
  const minDate = min ? parsePlainDate(min) : undefined;
  const maxDate = max ? parsePlainDate(max) : undefined;

  const {
    inputRef,
    inputValue,
    selectedDate,
    calendarMonth,
    setCalendarMonth,
    handleKeyDown,
    handleFocus,
    handleMouseUp,
    handleBlur,
    handleCalendarSelect,
  } = useSegmentedDateInput({ value, onChange });

  const disabledMatchers: Matcher[] = [];
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

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
            <DateFieldCalendarTrigger disabled={disabled} />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-auto rounded-md border border-gray-700 bg-gray-900 p-0 shadow-xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Calendar
            mode="single"
            selected={selectedDate}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            startMonth={minDate}
            endMonth={maxDate}
            disabled={disabledMatchers.length ? disabledMatchers : undefined}
            onSelect={(date) => {
              handleCalendarSelect(date);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default DatePicker;
