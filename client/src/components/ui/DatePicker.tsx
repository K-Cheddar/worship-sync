"use client";

import * as React from "react";
import { format, isValid, parse } from "date-fns";
import type { Matcher } from "react-day-picker";
import { CalendarDays } from "lucide-react";

import { cn } from "@/utils/cnHelper";
import Input from "@/components/ui/Input";
import Label from "@/components/ui/Label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import Calendar from "@/components/ui/Calendar";
import {
  formatDateInputValue,
  formatPlainDate,
  parsePlainDate,
} from "@/utils/plainDate";

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

/** Display/typing format. */
const DISPLAY_FORMAT = "MM/dd/yyyy";
/** Formats accepted when the user types a date. */
const PARSE_FORMATS = ["MM/dd/yyyy", "M/d/yyyy", "yyyy-MM-dd", "MMM d, yyyy", "MMMM d, yyyy"];

const parseTypedDate = (text: string): Date | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  for (const fmt of PARSE_FORMATS) {
    const parsed = parse(trimmed, fmt, new Date());
    if (isValid(parsed) && parsed.getFullYear() > 1000) return parsed;
  }
  return undefined;
};

const displayValue = (value: string) => {
  const date = parsePlainDate(value);
  return date ? format(date, DISPLAY_FORMAT) : "";
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
  const [text, setText] = React.useState(() => displayValue(value));
  const generatedId = React.useId();
  const fieldId = id || generatedId;
  const selected = parsePlainDate(value);
  const minDate = min ? parsePlainDate(min) : undefined;
  const maxDate = max ? parsePlainDate(max) : undefined;

  // Keep the input text in sync when the value changes from outside (e.g. the
  // calendar, or a parent reset).
  React.useEffect(() => {
    setText(displayValue(value));
  }, [value]);

  const disabledMatchers: Matcher[] = [];
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  const commitTyped = (next: string) => {
    setText(next);
    if (!next.trim()) {
      onChange("");
      return;
    }
    const parsed = parseTypedDate(next);
    if (parsed) onChange(formatPlainDate(parsed));
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
              type="text"
              inputMode="numeric"
              disabled={disabled}
              aria-label={ariaLabel || label}
              placeholder={placeholder}
              value={text}
              className={cn(
                "py-1 pl-2 pr-9 text-sm shadow-none",
                disabled && "cursor-not-allowed",
                inputClassName,
              )}
              onChange={(event) =>
                commitTyped(formatDateInputValue(event.target.value))
              }
              onBlur={() => setText(displayValue(value))}
            />
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                aria-label="Open calendar"
                className="absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:pointer-events-none"
              >
                <CalendarDays className="h-4 w-4" aria-hidden />
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-auto rounded-md border border-gray-700 bg-gray-900 p-0 shadow-xl"
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            startMonth={minDate}
            endMonth={maxDate}
            disabled={disabledMatchers.length ? disabledMatchers : undefined}
            onSelect={(date) => {
              onChange(date ? formatPlainDate(date) : "");
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default DatePicker;
