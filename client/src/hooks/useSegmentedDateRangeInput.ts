import * as React from "react";
import type { DateRange } from "react-day-picker";

import { pad2 } from "../constants";
import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";
import {
  buildDateFromParts,
  DATE_RANGE_FIELD_ORDER,
  daysInMonth,
  formatSegmentedDateRangeDisplay,
  getDateRangeFieldFromPos,
  getDateRangeFieldRange,
  parseDateRangeField,
  type DateRangeEndpoint,
  type DateRangeField,
} from "@/utils/segmentedDateInput";

export type DateRangeValue = {
  startDate: string;
  endDate: string;
};

type UseSegmentedDateRangeInputOptions = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
};

const partsFromValue = (dateValue: string) => {
  const parsed = parsePlainDate(dateValue);
  if (!parsed) {
    return {
      month: "",
      day: "",
      year: "",
      selectedDate: undefined as Date | undefined,
    };
  }
  return {
    month: pad2(parsed.getMonth() + 1),
    day: pad2(parsed.getDate()),
    year: String(parsed.getFullYear()),
    selectedDate: parsed,
  };
};

const buildEndpointDateString = (
  month: string,
  day: string,
  year: string,
  fallback: string,
) => {
  const date = buildDateFromParts(month, day, year);
  if (date) return formatPlainDate(date);
  if (!month && !day && !year) return "";
  return fallback;
};

export const useSegmentedDateRangeInput = ({
  value,
  onChange,
}: UseSegmentedDateRangeInputOptions) => {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const pendingFieldRef = React.useRef<DateRangeField | null>(null);
  const activeFieldRef = React.useRef<DateRangeField | null>(null);

  const initialStart = partsFromValue(value.startDate);
  const initialEnd = partsFromValue(value.endDate);

  const [startMonth, setStartMonth] = React.useState(initialStart.month);
  const [startDay, setStartDay] = React.useState(initialStart.day);
  const [startYear, setStartYear] = React.useState(initialStart.year);
  const [endMonth, setEndMonth] = React.useState(initialEnd.month);
  const [endDay, setEndDay] = React.useState(initialEnd.day);
  const [endYear, setEndYear] = React.useState(initialEnd.year);
  const [startSelectedDate, setStartSelectedDate] = React.useState(
    initialStart.selectedDate,
  );
  const [endSelectedDate, setEndSelectedDate] = React.useState(
    initialEnd.selectedDate,
  );
  const [startMonthEntry, setStartMonthEntry] = React.useState<string | null>(
    null,
  );
  const [startDayEntry, setStartDayEntry] = React.useState<string | null>(null);
  const [startYearEntry, setStartYearEntry] = React.useState<string | null>(
    null,
  );
  const [endMonthEntry, setEndMonthEntry] = React.useState<string | null>(null);
  const [endDayEntry, setEndDayEntry] = React.useState<string | null>(null);
  const [endYearEntry, setEndYearEntry] = React.useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = React.useState<Date>(
    () => initialStart.selectedDate ?? initialEnd.selectedDate ?? new Date(),
  );

  React.useEffect(() => {
    const nextStart = partsFromValue(value.startDate);
    const nextEnd = partsFromValue(value.endDate);
    setStartMonth(nextStart.month);
    setStartDay(nextStart.day);
    setStartYear(nextStart.year);
    setEndMonth(nextEnd.month);
    setEndDay(nextEnd.day);
    setEndYear(nextEnd.year);
    setStartSelectedDate(nextStart.selectedDate);
    setEndSelectedDate(nextEnd.selectedDate);
    setStartMonthEntry(null);
    setStartDayEntry(null);
    setStartYearEntry(null);
    setEndMonthEntry(null);
    setEndDayEntry(null);
    setEndYearEntry(null);
    const anchor = nextStart.selectedDate ?? nextEnd.selectedDate;
    if (anchor) setCalendarMonth(anchor);
  }, [value.endDate, value.startDate]);

  const clearEntryState = (endpoint: DateRangeEndpoint) => {
    if (endpoint === "start") {
      setStartMonthEntry(null);
      setStartDayEntry(null);
      setStartYearEntry(null);
      return;
    }
    setEndMonthEntry(null);
    setEndDayEntry(null);
    setEndYearEntry(null);
  };

  const getEndpointParts = (endpoint: DateRangeEndpoint) => {
    if (endpoint === "start") {
      return {
        month: startMonth,
        day: startDay,
        year: startYear,
        monthEntry: startMonthEntry,
        dayEntry: startDayEntry,
        yearEntry: startYearEntry,
        selectedDate: startSelectedDate,
      };
    }
    return {
      month: endMonth,
      day: endDay,
      year: endYear,
      monthEntry: endMonthEntry,
      dayEntry: endDayEntry,
      yearEntry: endYearEntry,
      selectedDate: endSelectedDate,
    };
  };

  const emitChange = (nextStart: string, nextEnd: string) => {
    onChange({ startDate: nextStart, endDate: nextEnd });
  };

  const syncEndpoint = (
    endpoint: DateRangeEndpoint,
    nextMonth: string,
    nextDay: string,
    nextYear: string,
  ) => {
    const nextDate = buildDateFromParts(nextMonth, nextDay, nextYear);
    const startDate = buildEndpointDateString(
      endpoint === "start" ? nextMonth : startMonth,
      endpoint === "start" ? nextDay : startDay,
      endpoint === "start" ? nextYear : startYear,
      value.startDate,
    );
    const endDate = buildEndpointDateString(
      endpoint === "end" ? nextMonth : endMonth,
      endpoint === "end" ? nextDay : endDay,
      endpoint === "end" ? nextYear : endYear,
      value.endDate,
    );

    if (endpoint === "start") {
      setStartMonth(nextMonth);
      setStartDay(nextDay);
      setStartYear(nextYear);
      setStartSelectedDate(nextDate);
    } else {
      setEndMonth(nextMonth);
      setEndDay(nextDay);
      setEndYear(nextYear);
      setEndSelectedDate(nextDate);
    }

    if (nextDate || (!nextMonth && !nextDay && !nextYear)) {
      emitChange(startDate, endDate);
    }
  };

  const selectField = (field: DateRangeField) => {
    const node = inputRef.current;
    if (!node) return;
    const before = activeFieldRef.current;
    if (before !== field) {
      clearEntryState(parseDateRangeField(field).endpoint);
    }
    pendingFieldRef.current = field;
    activeFieldRef.current = field;
    const range = getDateRangeFieldRange(field);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(range[0], range[1]);
    });
  };

  const moveToNextField = (field: DateRangeField) => {
    const index = DATE_RANGE_FIELD_ORDER.indexOf(field);
    if (index < DATE_RANGE_FIELD_ORDER.length - 1) {
      selectField(DATE_RANGE_FIELD_ORDER[index + 1]);
    }
  };

  const moveToPreviousField = (field: DateRangeField) => {
    const index = DATE_RANGE_FIELD_ORDER.indexOf(field);
    if (index > 0) {
      selectField(DATE_RANGE_FIELD_ORDER[index - 1]);
    }
  };

  const getActiveField = (caret: number): DateRangeField =>
    activeFieldRef.current ?? getDateRangeFieldFromPos(caret);

  const clearFieldSegment = (field: DateRangeField) => {
    const { endpoint, segment } = parseDateRangeField(field);
    clearEntryState(endpoint);
    const parts = getEndpointParts(endpoint);

    if (segment === "month") {
      syncEndpoint(endpoint, "", parts.day, parts.year);
      selectField(field);
      return;
    }
    if (segment === "day") {
      syncEndpoint(endpoint, parts.month, "", parts.year);
      selectField(field);
      return;
    }

    if (parts.yearEntry !== null) {
      const next = parts.yearEntry.slice(0, -1);
      if (next) {
        if (endpoint === "start") setStartYearEntry(next);
        else setEndYearEntry(next);
      } else {
        syncEndpoint(endpoint, parts.month, parts.day, "");
      }
    } else {
      syncEndpoint(endpoint, parts.month, parts.day, "");
    }
    selectField(field);
  };

  const incrementFieldSegment = (field: DateRangeField, delta: number) => {
    const { endpoint, segment } = parseDateRangeField(field);
    clearEntryState(endpoint);
    activeFieldRef.current = field;
    const parts = getEndpointParts(endpoint);

    if (segment === "month") {
      const current = Number(parts.month) || 1;
      let next = current + delta;
      if (next < 1) next = 12;
      if (next > 12) next = 1;
      syncEndpoint(
        endpoint,
        pad2(next),
        parts.day || "01",
        parts.year || String(new Date().getFullYear()),
      );
    } else if (segment === "day") {
      const y = Number(parts.year) || new Date().getFullYear();
      const m = Number(parts.month) || 1;
      const maxDay = daysInMonth(m, y);
      const current = Number(parts.day) || 1;
      let next = current + delta;
      if (next < 1) next = maxDay;
      if (next > maxDay) next = 1;
      syncEndpoint(
        endpoint,
        parts.month || pad2(m),
        pad2(next),
        parts.year || String(y),
      );
    } else {
      const current = Number(parts.year) || new Date().getFullYear();
      syncEndpoint(
        endpoint,
        parts.month || "01",
        parts.day || "01",
        String(current + delta),
      );
    }

    const range = getDateRangeFieldRange(field);
    const el = inputRef.current;
    if (el) el.setSelectionRange(range[0], range[1]);
  };

  const handleMaskedTyping = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const key = e.key;
    if (key === "Tab") return;
    const caret = e.currentTarget.selectionStart ?? 0;
    const field = getActiveField(caret);
    const { endpoint, segment } = parseDateRangeField(field);
    const parts = getEndpointParts(endpoint);

    if (key === "ArrowLeft") {
      e.preventDefault();
      moveToPreviousField(field);
      return;
    }
    if (key === "ArrowRight") {
      e.preventDefault();
      moveToNextField(field);
      return;
    }
    if (key === "Backspace" || key === "Delete") {
      e.preventDefault();
      clearFieldSegment(field);
      return;
    }

    if (segment === "month" && /^\d$/.test(key)) {
      e.preventDefault();
      const d = Number(key);
      if (parts.monthEntry === null) {
        if (d === 0) {
          if (endpoint === "start") {
            setStartMonthEntry("0");
            setStartMonth("0");
          } else {
            setEndMonthEntry("0");
            setEndMonth("0");
          }
          selectField(field);
          return;
        }
        if (d === 1) {
          if (endpoint === "start") {
            setStartMonthEntry("1");
            setStartMonth("1");
          } else {
            setEndMonthEntry("1");
            setEndMonth("1");
          }
          selectField(field);
          return;
        }
        syncEndpoint(
          endpoint,
          pad2(d),
          parts.day || "01",
          parts.year || String(new Date().getFullYear()),
        );
        clearEntryState(endpoint);
        moveToNextField(field);
        return;
      }
      if (parts.monthEntry === "0" || parts.monthEntry === "1") {
        const finalMonth = Number(`${parts.monthEntry}${d}`);
        if (finalMonth >= 1 && finalMonth <= 12) {
          syncEndpoint(
            endpoint,
            pad2(finalMonth),
            parts.day || "01",
            parts.year || String(new Date().getFullYear()),
          );
          clearEntryState(endpoint);
          moveToNextField(field);
        }
      }
      return;
    }

    if (segment === "day" && /^\d$/.test(key)) {
      e.preventDefault();
      const d = Number(key);
      if (parts.dayEntry === null) {
        if (d >= 0 && d <= 3) {
          if (endpoint === "start") {
            setStartDayEntry(String(d));
            setStartDay(pad2(d));
          } else {
            setEndDayEntry(String(d));
            setEndDay(pad2(d));
          }
          selectField(field);
          return;
        }
        syncEndpoint(
          endpoint,
          parts.month || "01",
          pad2(d),
          parts.year || String(new Date().getFullYear()),
        );
        clearEntryState(endpoint);
        moveToNextField(field);
        return;
      }
      const first = Number(parts.dayEntry);
      const finalDay = first * 10 + d;
      const y = Number(parts.year) || new Date().getFullYear();
      const m = Number(parts.month) || 1;
      const clamped = Math.max(1, Math.min(daysInMonth(m, y), finalDay));
      syncEndpoint(
        endpoint,
        parts.month || pad2(m),
        pad2(clamped),
        parts.year || String(y),
      );
      clearEntryState(endpoint);
      moveToNextField(field);
      return;
    }

    if (segment === "year" && /^\d$/.test(key)) {
      e.preventDefault();
      const nextEntry =
        parts.yearEntry === null ? key : `${parts.yearEntry}${key}`.slice(0, 4);
      if (endpoint === "start") setStartYearEntry(nextEntry);
      else setEndYearEntry(nextEntry);
      activeFieldRef.current = field;
      selectField(field);
      if (nextEntry.length === 4) {
        syncEndpoint(
          endpoint,
          parts.month || "01",
          parts.day || "01",
          nextEntry,
        );
        clearEntryState(endpoint);
        moveToNextField(field);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const field = getActiveField(e.currentTarget.selectionStart ?? 0);
      activeFieldRef.current = field;
      incrementFieldSegment(field, -1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const field = getActiveField(e.currentTarget.selectionStart ?? 0);
      activeFieldRef.current = field;
      incrementFieldSegment(field, 1);
      return;
    }
    handleMaskedTyping(e);
  };

  const handleFocus = () => {
    const requested = pendingFieldRef.current;
    if (requested) {
      const range = getDateRangeFieldRange(requested);
      pendingFieldRef.current = null;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.setSelectionRange(range[0], range[1]);
      });
      return;
    }
    requestAnimationFrame(() => selectField("start-month"));
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
    const caret = e.currentTarget.selectionStart ?? 0;
    selectField(getDateRangeFieldFromPos(caret));
  };

  const handleBlur = () => {
    const nextStart = partsFromValue(value.startDate);
    const nextEnd = partsFromValue(value.endDate);
    setStartMonth(nextStart.month);
    setStartDay(nextStart.day);
    setStartYear(nextStart.year);
    setEndMonth(nextEnd.month);
    setEndDay(nextEnd.day);
    setEndYear(nextEnd.year);
    setStartSelectedDate(nextStart.selectedDate);
    setEndSelectedDate(nextEnd.selectedDate);
    setStartMonthEntry(null);
    setStartDayEntry(null);
    setStartYearEntry(null);
    setEndMonthEntry(null);
    setEndDayEntry(null);
    setEndYearEntry(null);
  };

  const applyCalendarRange = (range: DateRange | undefined) => {
    if (!range?.from) {
      emitChange("", "");
      setStartMonth("");
      setStartDay("");
      setStartYear("");
      setEndMonth("");
      setEndDay("");
      setEndYear("");
      setStartSelectedDate(undefined);
      setEndSelectedDate(undefined);
      return;
    }

    const startParts = partsFromValue(formatPlainDate(range.from));
    setStartMonth(startParts.month);
    setStartDay(startParts.day);
    setStartYear(startParts.year);
    setStartSelectedDate(startParts.selectedDate);

    if (range.to) {
      const endParts = partsFromValue(formatPlainDate(range.to));
      setEndMonth(endParts.month);
      setEndDay(endParts.day);
      setEndYear(endParts.year);
      setEndSelectedDate(endParts.selectedDate);
      emitChange(formatPlainDate(range.from), formatPlainDate(range.to));
      return;
    }

    setEndMonth("");
    setEndDay("");
    setEndYear("");
    setEndSelectedDate(undefined);
    emitChange(formatPlainDate(range.from), "");
  };

  const resolvedStartDate = React.useMemo(() => {
    const yearText = startYearEntry ?? startYear;
    if (!/^\d{4}$/.test(yearText) || !startMonth || !startDay)
      return startSelectedDate;
    return (
      buildDateFromParts(startMonth, startDay, yearText) ?? startSelectedDate
    );
  }, [startDay, startMonth, startSelectedDate, startYear, startYearEntry]);

  const resolvedEndDate = React.useMemo(() => {
    const yearText = endYearEntry ?? endYear;
    if (!/^\d{4}$/.test(yearText) || !endMonth || !endDay)
      return endSelectedDate;
    return buildDateFromParts(endMonth, endDay, yearText) ?? endSelectedDate;
  }, [endDay, endMonth, endSelectedDate, endYear, endYearEntry]);

  const selectedRange = React.useMemo((): DateRange | undefined => {
    if (!resolvedStartDate) return undefined;
    return { from: resolvedStartDate, to: resolvedEndDate || undefined };
  }, [resolvedEndDate, resolvedStartDate]);

  React.useEffect(() => {
    const anchor = resolvedStartDate ?? resolvedEndDate;
    if (!anchor) return;
    setCalendarMonth((current) =>
      current.getFullYear() === anchor.getFullYear() &&
      current.getMonth() === anchor.getMonth()
        ? current
        : anchor,
    );
  }, [resolvedEndDate, resolvedStartDate]);

  const inputValue = formatSegmentedDateRangeDisplay(
    {
      month: startMonth,
      day: startDay,
      year: startYear,
      yearEntry: startYearEntry,
    },
    {
      month: endMonth,
      day: endDay,
      year: endYear,
      yearEntry: endYearEntry,
    },
  );

  return {
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
  };
};
