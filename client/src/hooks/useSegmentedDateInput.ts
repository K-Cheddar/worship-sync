import * as React from "react";

import { pad2 } from "../constants";
import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";
import {
  buildDateFromParts,
  DATE_SEGMENT_ORDER,
  DATE_SEGMENT_RANGES,
  daysInMonth,
  formatSegmentedDateDisplay,
  getDateSegmentFromPos,
  type DateSegment,
} from "@/utils/segmentedDateInput";

type UseSegmentedDateInputOptions = {
  value: string;
  onChange: (value: string) => void;
};

const partsFromValue = (value: string) => {
  const parsed = parsePlainDate(value);
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

export const useSegmentedDateInput = ({
  value,
  onChange,
}: UseSegmentedDateInputOptions) => {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const pendingSegmentRef = React.useRef<DateSegment | null>(null);
  const activeSegmentRef = React.useRef<DateSegment | null>(null);

  const initial = partsFromValue(value);
  const [month, setMonth] = React.useState(initial.month);
  const [day, setDay] = React.useState(initial.day);
  const [year, setYear] = React.useState(initial.year);
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(
    initial.selectedDate,
  );
  const [monthEntry, setMonthEntry] = React.useState<string | null>(null);
  const [dayEntry, setDayEntry] = React.useState<string | null>(null);
  const [yearEntry, setYearEntry] = React.useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = React.useState<Date>(
    () => initial.selectedDate ?? new Date(),
  );

  React.useEffect(() => {
    const next = partsFromValue(value);
    setMonth(next.month);
    setDay(next.day);
    setYear(next.year);
    setSelectedDate(next.selectedDate);
    setMonthEntry(null);
    setDayEntry(null);
    setYearEntry(null);
    if (next.selectedDate) {
      setCalendarMonth(next.selectedDate);
    }
  }, [value]);

  const resolvedDate = React.useMemo(() => {
    const yearText = yearEntry ?? year;
    if (!/^\d{4}$/.test(yearText) || !month || !day) return selectedDate;
    return buildDateFromParts(month, day, yearText) ?? selectedDate;
  }, [selectedDate, month, day, year, yearEntry]);

  const calendarAnchor = React.useMemo(() => {
    if (resolvedDate) return resolvedDate;

    const yearText = yearEntry ?? year;
    const monthNum = Number(month);
    if (/^\d{4}$/.test(yearText) && monthNum >= 1 && monthNum <= 12) {
      return new Date(Number(yearText), monthNum - 1, 1);
    }
    if (monthNum >= 1 && monthNum <= 12) {
      return new Date(new Date().getFullYear(), monthNum - 1, 1);
    }

    return undefined;
  }, [resolvedDate, month, year, yearEntry]);

  React.useEffect(() => {
    if (!calendarAnchor) return;
    setCalendarMonth((current) =>
      current.getFullYear() === calendarAnchor.getFullYear() &&
      current.getMonth() === calendarAnchor.getMonth()
        ? current
        : calendarAnchor,
    );
  }, [calendarAnchor]);

  const syncParts = (nextMonth: string, nextDay: string, nextYear: string) => {
    setMonth(nextMonth);
    setDay(nextDay);
    setYear(nextYear);
    const nextDate = buildDateFromParts(nextMonth, nextDay, nextYear);
    setSelectedDate(nextDate);
    if (nextDate) {
      onChange(formatPlainDate(nextDate));
      return;
    }
    if (!nextMonth && !nextDay && !nextYear) {
      onChange("");
    }
  };

  const selectSegment = (segment: DateSegment) => {
    const node = inputRef.current;
    if (!node) return;
    const before = getDateSegmentFromPos(node.selectionStart ?? 0);
    if (before !== segment) {
      setMonthEntry(null);
      setDayEntry(null);
      setYearEntry(null);
    }
    pendingSegmentRef.current = segment;
    activeSegmentRef.current = segment;
    const range = DATE_SEGMENT_RANGES[segment];
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(range[0], range[1]);
    });
  };

  const moveToNextSegment = (segment: DateSegment) => {
    const index = DATE_SEGMENT_ORDER.indexOf(segment);
    if (index < DATE_SEGMENT_ORDER.length - 1) {
      selectSegment(DATE_SEGMENT_ORDER[index + 1]);
    }
  };

  const moveToPreviousSegment = (segment: DateSegment) => {
    const index = DATE_SEGMENT_ORDER.indexOf(segment);
    if (index > 0) {
      selectSegment(DATE_SEGMENT_ORDER[index - 1]);
    }
  };

  const getActiveSegment = (caret: number): DateSegment =>
    activeSegmentRef.current ?? getDateSegmentFromPos(caret);

  const clearSegment = (segment: DateSegment) => {
    setMonthEntry(null);
    setDayEntry(null);
    setYearEntry(null);

    if (segment === "month") {
      syncParts("", day, year);
      selectSegment("month");
      return;
    }
    if (segment === "day") {
      syncParts(month, "", year);
      selectSegment("day");
      return;
    }

    if (yearEntry !== null) {
      const next = yearEntry.slice(0, -1);
      if (next) {
        setYearEntry(next);
      } else {
        setYearEntry(null);
        syncParts(month, day, "");
      }
    } else {
      syncParts(month, day, "");
    }
    selectSegment("year");
  };

  const incrementSegment = (segment: DateSegment, delta: number) => {
    setMonthEntry(null);
    setDayEntry(null);
    setYearEntry(null);

    const activeSegment = activeSegmentRef.current || segment;
    activeSegmentRef.current = activeSegment;

    if (activeSegment === "month") {
      const current = Number(month) || 1;
      let next = current + delta;
      if (next < 1) next = 12;
      if (next > 12) next = 1;
      syncParts(
        pad2(next),
        day || "01",
        year || String(new Date().getFullYear()),
      );
    } else if (activeSegment === "day") {
      const y = Number(year) || new Date().getFullYear();
      const m = Number(month) || 1;
      const maxDay = daysInMonth(m, y);
      const current = Number(day) || 1;
      let next = current + delta;
      if (next < 1) next = maxDay;
      if (next > maxDay) next = 1;
      syncParts(month || pad2(m), pad2(next), year || String(y));
    } else {
      const current = Number(year) || new Date().getFullYear();
      syncParts(month || "01", day || "01", String(current + delta));
    }

    const range = DATE_SEGMENT_RANGES[activeSegment];
    const el = inputRef.current;
    if (el) el.setSelectionRange(range[0], range[1]);
  };

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
    if (key === "Backspace" || key === "Delete") {
      e.preventDefault();
      clearSegment(segment);
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
        syncParts(
          pad2(d),
          day || "01",
          year || String(new Date().getFullYear()),
        );
        setMonthEntry(null);
        moveToNextSegment("month");
        return;
      }
      if (monthEntry === "0" || monthEntry === "1") {
        const finalMonth = Number(`${monthEntry}${d}`);
        if (finalMonth >= 1 && finalMonth <= 12) {
          syncParts(
            pad2(finalMonth),
            day || "01",
            year || String(new Date().getFullYear()),
          );
          setMonthEntry(null);
          moveToNextSegment("month");
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
        syncParts(
          month || "01",
          pad2(d),
          year || String(new Date().getFullYear()),
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
      syncParts(month || pad2(m), pad2(clamped), year || String(y));
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
        syncParts(month || "01", day || "01", nextEntry);
        setYearEntry(null);
        moveToNextSegment("year");
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const segment = getActiveSegment(e.currentTarget.selectionStart ?? 0);
      activeSegmentRef.current = segment;
      incrementSegment(segment, -1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const segment = getActiveSegment(e.currentTarget.selectionStart ?? 0);
      activeSegmentRef.current = segment;
      incrementSegment(segment, 1);
    }
    handleMaskedTyping(e);
  };

  const handleFocus = () => {
    const requested = pendingSegmentRef.current;
    if (requested) {
      const range = DATE_SEGMENT_RANGES[requested];
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
    selectSegment(getDateSegmentFromPos(caret));
  };

  const handleBlur = () => {
    const next = partsFromValue(value);
    setMonth(next.month);
    setDay(next.day);
    setYear(next.year);
    setSelectedDate(next.selectedDate);
    setMonthEntry(null);
    setDayEntry(null);
    setYearEntry(null);
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) return;
    syncParts(
      pad2(date.getMonth() + 1),
      pad2(date.getDate()),
      String(date.getFullYear()),
    );
    setMonthEntry(null);
    setDayEntry(null);
    setYearEntry(null);
  };

  const inputValue = formatSegmentedDateDisplay({
    month,
    day,
    year,
    yearEntry,
  });

  return {
    inputRef,
    inputValue,
    selectedDate: resolvedDate,
    calendarMonth,
    setCalendarMonth,
    handleKeyDown,
    handleFocus,
    handleMouseUp,
    handleBlur,
    handleCalendarSelect,
  };
};
