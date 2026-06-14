"use client";

import * as React from "react";
import type { Matcher } from "react-day-picker";
import { CalendarDays } from "lucide-react";

import { HOURS, pad2 } from "../../constants";
import { cn } from "@/utils/cnHelper";
import { parsePlainDate } from "@/utils/plainDate";
import {
  formatDateTimeDisplay,
  formatDateTimeLocal,
  parseDateTimeLocal,
} from "@/utils/dateTimeValue";
import Input from "@/components/ui/Input";
import Label from "@/components/ui/Label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import Calendar from "@/components/ui/Calendar";
import { Listbox } from "@/components/TimePicker/ListBox";
import type { Meridiem } from "@/components/TimePicker/types";

const MERIDIEMS: Meridiem[] = ["AM", "PM"];
const ALL_MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i));

type Segment =
  | "month"
  | "day"
  | "year"
  | "hour"
  | "minute"
  | "meridiem";

const SEGMENT_RANGES: Record<Segment, [number, number]> = {
  month: [0, 2],
  day: [3, 5],
  year: [6, 10],
  hour: [11, 13],
  minute: [14, 16],
  meridiem: [17, 19],
};

const SEGMENT_ORDER: Segment[] = [
  "month",
  "day",
  "year",
  "hour",
  "minute",
  "meridiem",
];

const getSegmentFromPos = (pos: number): Segment => {
  if (pos <= 1) return "month";
  if (pos <= 4) return "day";
  if (pos <= 9) return "year";
  if (pos <= 12) return "hour";
  if (pos <= 15) return "minute";
  return "meridiem";
};

const daysInMonth = (month: number, year: number) =>
  new Date(year, month, 0).getDate();

const buildDate = (month: string, day: string, year: string): Date | undefined => {
  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  if (!m || !d || !y || year.length < 4) return undefined;
  const parsed = new Date(y, m - 1, d);
  if (
    parsed.getFullYear() !== y ||
    parsed.getMonth() !== m - 1 ||
    parsed.getDate() !== d
  ) {
    return undefined;
  }
  return parsed;
};

export type DateTimePickerProps = {
  /** Value is `yyyy-MM-ddTHH:mm` (datetime-local, no timezone). */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hideLabel?: boolean;
  labelClassName?: string;
  disabled?: boolean;
  /** Earliest selectable date, `yyyy-MM-dd`. */
  min?: string;
  /** Latest selectable date, `yyyy-MM-dd`. */
  max?: string;
  className?: string;
  inputClassName?: string;
  portal?: boolean;
  id?: string;
  "aria-label"?: string;
};

const DateTimePicker = ({
  value,
  onChange,
  label,
  hideLabel = false,
  labelClassName,
  disabled = false,
  min,
  max,
  className,
  inputClassName,
  portal = true,
  id,
  "aria-label": ariaLabel,
}: DateTimePickerProps) => {
  const [open, setOpen] = React.useState(false);
  const generatedId = React.useId();
  const fieldId = id || generatedId;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const pendingSegmentRef = React.useRef<Segment | null>(null);
  const activeSegmentRef = React.useRef<Segment | null>(null);

  const parsed = React.useMemo(() => parseDateTimeLocal(value), [value]);

  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(
    parsed?.date,
  );
  const [month, setMonth] = React.useState(
    parsed?.date ? pad2(parsed.date.getMonth() + 1) : "",
  );
  const [day, setDay] = React.useState(
    parsed?.date ? pad2(parsed.date.getDate()) : "",
  );
  const [year, setYear] = React.useState(
    parsed?.date ? String(parsed.date.getFullYear()) : "",
  );
  const [hour, setHour] = React.useState(parsed?.hour || "");
  const [minute, setMinute] = React.useState(parsed?.minute || "");
  const [meridiem, setMeridiem] = React.useState<Meridiem>(
    parsed?.meridiem || "",
  );

  const [monthEntry, setMonthEntry] = React.useState<string | null>(null);
  const [dayEntry, setDayEntry] = React.useState<string | null>(null);
  const [yearEntry, setYearEntry] = React.useState<string | null>(null);
  const [hourEntry, setHourEntry] = React.useState<string | null>(null);
  const [minuteEntry, setMinuteEntry] = React.useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = React.useState<Date>(
    () => parsed?.date ?? new Date(),
  );

  const resolvedDate = React.useMemo(() => {
    const yearText = yearEntry ?? year;
    if (!/^\d{4}$/.test(yearText) || !month || !day) return selectedDate;
    return buildDate(month, day, yearText) ?? selectedDate;
  }, [selectedDate, month, day, year, yearEntry]);

  const calendarAnchor = React.useMemo(() => {
    if (resolvedDate) return resolvedDate;

    const yearText = yearEntry ?? year;
    const monthNum = Number(month);
    if (/^\d{4}$/.test(yearText) && monthNum >= 1 && monthNum <= 12) {
      return new Date(Number(yearText), monthNum - 1, 1);
    }

    return undefined;
  }, [resolvedDate, month, year, yearEntry]);

  React.useEffect(() => {
    if (!calendarAnchor) return;
    setCalendarMonth(
      (current) =>
        current.getFullYear() === calendarAnchor.getFullYear() &&
          current.getMonth() === calendarAnchor.getMonth()
          ? current
          : calendarAnchor,
    );
  }, [calendarAnchor]);

  React.useEffect(() => {
    if (!value) {
      setSelectedDate(undefined);
      setMonth("");
      setDay("");
      setYear("");
      setHour("");
      setMinute("");
      setMeridiem("");
      return;
    }
    const next = parseDateTimeLocal(value);
    if (!next) return;
    setSelectedDate(next.date);
    setMonth(pad2(next.date.getMonth() + 1));
    setDay(pad2(next.date.getDate()));
    setYear(String(next.date.getFullYear()));
    setHour(next.hour);
    setMinute(next.minute);
    setMeridiem(next.meridiem);
  }, [value]);

  const minDate = min ? parsePlainDate(min) : undefined;
  const maxDate = max ? parsePlainDate(max) : undefined;
  const disabledMatchers: Matcher[] = [];
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  const commitValue = (
    nextDate: Date | undefined,
    nextHour: string,
    nextMinute: string,
    nextMeridiem: Meridiem,
  ) => {
    if (!nextDate || !nextHour || !nextMinute || !nextMeridiem) return;
    const nextValue = formatDateTimeLocal(
      nextDate,
      nextHour,
      nextMinute,
      nextMeridiem,
    );
    if (nextValue) onChange(nextValue);
  };

  const syncDateParts = (nextMonth: string, nextDay: string, nextYear: string) => {
    setMonth(nextMonth);
    setDay(nextDay);
    setYear(nextYear);
    const nextDate = buildDate(nextMonth, nextDay, nextYear);
    setSelectedDate(nextDate);
    return nextDate;
  };

  const commitDateAndTime = (
    nextMonth: string,
    nextDay: string,
    nextYear: string,
    nextHour: string,
    nextMinute: string,
    nextMeridiem: Meridiem,
  ) => {
    const nextDate = syncDateParts(nextMonth, nextDay, nextYear);
    setHour(nextHour);
    setMinute(nextMinute);
    setMeridiem(nextMeridiem);
    commitValue(nextDate, nextHour, nextMinute, nextMeridiem);
  };

  const selectSegment = (segment: Segment) => {
    const node = inputRef.current;
    if (!node) return;
    const before = getSegmentFromPos(node.selectionStart ?? 0);
    if (before !== segment) {
      setMonthEntry(null);
      setDayEntry(null);
      setYearEntry(null);
      setHourEntry(null);
      setMinuteEntry(null);
    }
    pendingSegmentRef.current = segment;
    activeSegmentRef.current = segment;
    const range = SEGMENT_RANGES[segment];
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(range[0], range[1]);
    });
  };

  const moveToNextSegment = (segment: Segment) => {
    const index = SEGMENT_ORDER.indexOf(segment);
    if (index < SEGMENT_ORDER.length - 1) {
      selectSegment(SEGMENT_ORDER[index + 1]);
    }
  };

  const moveToPreviousSegment = (segment: Segment) => {
    const index = SEGMENT_ORDER.indexOf(segment);
    if (index > 0) {
      selectSegment(SEGMENT_ORDER[index - 1]);
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    const nextMonth = pad2(date.getMonth() + 1);
    const nextDay = pad2(date.getDate());
    const nextYear = String(date.getFullYear());
    commitDateAndTime(
      nextMonth,
      nextDay,
      nextYear,
      hour || "12",
      minute || "00",
      meridiem || "AM",
    );
  };

  const incrementSegment = (segment: Segment, delta: number) => {
    setMonthEntry(null);
    setDayEntry(null);
    setYearEntry(null);
    setHourEntry(null);
    setMinuteEntry(null);

    const activeSegment = activeSegmentRef.current || segment;
    activeSegmentRef.current = activeSegment;

    if (activeSegment === "month") {
      const current = Number(month) || 1;
      let next = current + delta;
      if (next < 1) next = 12;
      if (next > 12) next = 1;
      const nextMonth = pad2(next);
      const nextDate = syncDateParts(nextMonth, day || "01", year || String(new Date().getFullYear()));
      commitValue(nextDate, hour || "12", minute || "00", meridiem || "AM");
    } else if (activeSegment === "day") {
      const y = Number(year) || new Date().getFullYear();
      const m = Number(month) || 1;
      const maxDay = daysInMonth(m, y);
      const current = Number(day) || 1;
      let next = current + delta;
      if (next < 1) next = maxDay;
      if (next > maxDay) next = 1;
      const nextDay = pad2(next);
      const nextDate = syncDateParts(month || pad2(m), nextDay, year || String(y));
      commitValue(nextDate, hour || "12", minute || "00", meridiem || "AM");
    } else if (activeSegment === "year") {
      const current = Number(year) || new Date().getFullYear();
      const nextYear = String(current + delta);
      const nextDate = syncDateParts(month || "01", day || "01", nextYear);
      commitValue(nextDate, hour || "12", minute || "00", meridiem || "AM");
    } else if (activeSegment === "hour") {
      const current = Number(hour) || 12;
      let next = current + delta;
      if (next < 1) next = 12;
      if (next > 12) next = 1;
      commitDateAndTime(
        month || "01",
        day || "01",
        year || String(new Date().getFullYear()),
        String(next),
        minute || "00",
        meridiem || "AM",
      );
    } else if (activeSegment === "minute") {
      const current = Number(minute) || 0;
      let next = current + delta;
      if (next < 0) next = 59;
      if (next > 59) next = 0;
      commitDateAndTime(
        month || "01",
        day || "01",
        year || String(new Date().getFullYear()),
        hour || "12",
        pad2(next),
        meridiem || "AM",
      );
    } else if (activeSegment === "meridiem") {
      const nextMeridiem: Meridiem = meridiem === "AM" ? "PM" : "AM";
      commitDateAndTime(
        month || "01",
        day || "01",
        year || String(new Date().getFullYear()),
        hour || "12",
        minute || "00",
        nextMeridiem,
      );
    }

    const range = SEGMENT_RANGES[activeSegment];
    const el = inputRef.current;
    if (el) el.setSelectionRange(range[0], range[1]);
  };

  const getActiveSegment = (caret: number): Segment =>
    activeSegmentRef.current ?? getSegmentFromPos(caret);

  const handleMaskedTyping = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const key = e.key;
    if (key === "Tab") return;
    const caret = e.currentTarget.selectionStart ?? 0;
    const segment = getActiveSegment(caret);

    if (key === "ArrowLeft") {
      e.preventDefault();
      moveToPreviousSegment(segment);
      return;
    }
    if (key === "ArrowRight") {
      e.preventDefault();
      moveToNextSegment(segment);
      return;
    }

    if (segment === "month" && /^\d$/.test(key)) {
      e.preventDefault();
      const d = Number(key);
      if (monthEntry === null) {
        if (d === 0) {
          setMonthEntry("0");
          setMonth("0");
          selectSegment("month");
          return;
        }
        if (d === 1) {
          setMonthEntry("1");
          setMonth("1");
          selectSegment("month");
          return;
        }
        commitDateAndTime(
          pad2(d),
          day || "01",
          year || String(new Date().getFullYear()),
          hour || "12",
          minute || "00",
          meridiem || "AM",
        );
        setMonthEntry(null);
        moveToNextSegment("month");
        return;
      }
      if (monthEntry === "0" || monthEntry === "1") {
        const finalMonth = Number(`${monthEntry}${d}`);
        if (finalMonth >= 1 && finalMonth <= 12) {
          commitDateAndTime(
            pad2(finalMonth),
            day || "01",
            year || String(new Date().getFullYear()),
            hour || "12",
            minute || "00",
            meridiem || "AM",
          );
          setMonthEntry(null);
          moveToNextSegment("month");
          return;
        }
      }
      return;
    }

    if (segment === "day" && /^\d$/.test(key)) {
      e.preventDefault();
      const d = Number(key);
      if (dayEntry === null) {
        if (d >= 0 && d <= 3) {
          setDayEntry(String(d));
          setDay(pad2(d));
          selectSegment("day");
          return;
        }
        commitDateAndTime(
          month || "01",
          pad2(d),
          year || String(new Date().getFullYear()),
          hour || "12",
          minute || "00",
          meridiem || "AM",
        );
        setDayEntry(null);
        moveToNextSegment("day");
        return;
      }
      const first = Number(dayEntry);
      const finalDay = first * 10 + d;
      const y = Number(year) || new Date().getFullYear();
      const m = Number(month) || 1;
      const clamped = Math.max(1, Math.min(daysInMonth(m, y), finalDay));
      commitDateAndTime(
        month || pad2(m),
        pad2(clamped),
        year || String(y),
        hour || "12",
        minute || "00",
        meridiem || "AM",
      );
      setDayEntry(null);
      moveToNextSegment("day");
      return;
    }

    if (segment === "year" && /^\d$/.test(key)) {
      e.preventDefault();
      const nextEntry =
        yearEntry === null ? key : `${yearEntry}${key}`.slice(0, 4);
      setYearEntry(nextEntry);
      activeSegmentRef.current = "year";
      selectSegment("year");
      if (nextEntry.length === 4) {
        commitDateAndTime(
          month || "01",
          day || "01",
          nextEntry,
          hour || "12",
          minute || "00",
          meridiem || "AM",
        );
        setYearEntry(null);
        moveToNextSegment("year");
      }
      return;
    }

    if (segment === "hour" && /^\d$/.test(key)) {
      e.preventDefault();
      const d = Number(key);
      if (hourEntry === null) {
        if (d === 0) {
          setHourEntry("0");
          setHour("0");
          selectSegment("hour");
          return;
        }
        if (d === 1) {
          setHourEntry("1");
          setHour("1");
          selectSegment("hour");
          return;
        }
        commitDateAndTime(
          month || "01",
          day || "01",
          year || String(new Date().getFullYear()),
          String(d),
          minute || "00",
          meridiem || "AM",
        );
        setHourEntry(null);
        moveToNextSegment("hour");
        return;
      }
      if (hourEntry === "0" || hourEntry === "1") {
        const finalHour = Number(`${hourEntry}${d}`);
        if (finalHour >= 1 && finalHour <= 12) {
          commitDateAndTime(
            month || "01",
            day || "01",
            year || String(new Date().getFullYear()),
            String(finalHour),
            minute || "00",
            meridiem || "AM",
          );
          setHourEntry(null);
          moveToNextSegment("hour");
          return;
        }
      }
      return;
    }

    if (segment === "minute" && /^\d$/.test(key)) {
      e.preventDefault();
      const d = Number(key);
      if (minuteEntry === null) {
        if (d >= 0 && d <= 5) {
          setMinuteEntry(String(d));
          setMinute(pad2(d));
          selectSegment("minute");
          return;
        }
        commitDateAndTime(
          month || "01",
          day || "01",
          year || String(new Date().getFullYear()),
          hour || "12",
          pad2(d),
          meridiem || "AM",
        );
        setMinuteEntry(null);
        moveToNextSegment("minute");
        return;
      }
      const first = Number(minuteEntry);
      const final = first * 10 + d;
      commitDateAndTime(
        month || "01",
        day || "01",
        year || String(new Date().getFullYear()),
        hour || "12",
        pad2(Math.max(0, Math.min(59, final))),
        meridiem || "AM",
      );
      setMinuteEntry(null);
      moveToNextSegment("minute");
      return;
    }

    if (segment === "meridiem") {
      e.preventDefault();
      if (key.toLowerCase() === "a") {
        commitDateAndTime(
          month || "01",
          day || "01",
          year || String(new Date().getFullYear()),
          hour || "12",
          minute || "00",
          "AM",
        );
        selectSegment("meridiem");
        return;
      }
      if (key.toLowerCase() === "p") {
        commitDateAndTime(
          month || "01",
          day || "01",
          year || String(new Date().getFullYear()),
          hour || "12",
          minute || "00",
          "PM",
        );
        selectSegment("meridiem");
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const segment = getActiveSegment(e.currentTarget.selectionStart ?? 0);
      if (segment) {
        activeSegmentRef.current = segment;
        incrementSegment(segment, -1);
      } else {
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const segment = getActiveSegment(e.currentTarget.selectionStart ?? 0);
      if (segment) {
        activeSegmentRef.current = segment;
        incrementSegment(segment, 1);
      }
      return;
    }
    handleMaskedTyping(e);
  };

  const handleFocus = () => {
    const requested = pendingSegmentRef.current;
    if (requested) {
      const range = SEGMENT_RANGES[requested];
      pendingSegmentRef.current = null;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.setSelectionRange(range[0], range[1]);
      });
      return;
    }
    requestAnimationFrame(() => selectSegment("month"));
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
    const caret = e.currentTarget.selectionStart ?? 0;
    selectSegment(getSegmentFromPos(caret));
  };

  const inputValue = formatDateTimeDisplay({
    month,
    day,
    year,
    hour,
    minute,
    meridiem,
    yearEntry,
  });

  return (
    <div className={cn("group relative h-fit", className)}>
      {label ? (
        <Label
          htmlFor={fieldId}
          className={cn(
            "block p-1 text-sm font-semibold text-white",
            hideLabel && "sr-only",
            labelClassName,
          )}
        >
          {label}:
        </Label>
      ) : null}

      <Popover
        open={disabled ? false : open}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger asChild>
          <div className="relative">
            <Input
              id={fieldId}
              value={inputValue}
              onChange={() => { }}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onMouseUp={handleMouseUp}
              aria-label={ariaLabel || label || "Date and time"}
              role="combobox"
              aria-expanded={open}
              className={cn(
                "pr-9",
                inputClassName,
              )}
              ref={inputRef}
              readOnly
              disabled={disabled}
            />
            <CalendarDays
              className="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>
        </PopoverTrigger>

        {!disabled ? (
          <PopoverContent
            align="start"
            className="w-auto rounded-md border border-gray-700 bg-gray-900 p-0 shadow-xl"
            onOpenAutoFocus={(e) => e.preventDefault()}
            portal={portal}
          >
            <div className="flex gap-0 sm:gap-1">
              <Calendar
                mode="single"
                selected={resolvedDate}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                disabled={disabledMatchers.length ? disabledMatchers : undefined}
                onSelect={handleDateSelect}
              />
              <div
                className="flex gap-1 border-t border-gray-700 p-3 sm:border-t-0 sm:border-l"
                role="group"
                aria-label="Time selection lists"
              >
                <Listbox
                  label="Hour"
                  aria-label="Select hour"
                  items={HOURS}
                  value={hour}
                  onChange={(h) => {
                    commitDateAndTime(
                      month || "01",
                      day || "01",
                      year || String(new Date().getFullYear()),
                      h,
                      minute || "00",
                      meridiem || "AM",
                    );
                    selectSegment("hour");
                  }}
                />
                <Listbox
                  label="Minute"
                  aria-label="Select minutes"
                  items={ALL_MINUTES}
                  value={minute}
                  onChange={(m) => {
                    commitDateAndTime(
                      month || "01",
                      day || "01",
                      year || String(new Date().getFullYear()),
                      hour || "12",
                      m,
                      meridiem || "AM",
                    );
                    selectSegment("minute");
                  }}
                />
                <Listbox
                  label="AM/PM"
                  aria-label="Select AM or PM"
                  items={MERIDIEMS}
                  value={meridiem}
                  onChange={(ap) => {
                    commitDateAndTime(
                      month || "01",
                      day || "01",
                      year || String(new Date().getFullYear()),
                      hour || "12",
                      minute || "00",
                      ap as Meridiem,
                    );
                    selectSegment("meridiem");
                  }}
                />
              </div>
            </div>
          </PopoverContent>
        ) : null}
      </Popover>
    </div>
  );
};

export default DateTimePicker;
