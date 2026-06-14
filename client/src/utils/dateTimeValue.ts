import { pad2 } from "../constants";
import {
  formatTimeCountdown,
  parseTimeCountdown,
} from "@/components/TimePicker/utils";
import type { Meridiem } from "@/components/TimePicker/types";
import { formatPlainDate, parsePlainDate } from "@/utils/plainDate";

export type DateTimeParts = {
  date: Date;
  hour: string;
  minute: string;
  meridiem: Meridiem;
};

/** Parse `yyyy-MM-ddTHH:mm` (datetime-local) into local date/time parts. */
export const parseDateTimeLocal = (value: string): DateTimeParts | null => {
  if (!value) return null;
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return null;

  const date = parsePlainDate(datePart);
  const time = parseTimeCountdown(timePart);
  if (!date || !time || !time.meridiem) return null;

  return {
    date,
    hour: time.hour,
    minute: time.minute,
    meridiem: time.meridiem,
  };
};

/** Format local date/time parts into `yyyy-MM-ddTHH:mm`. */
export const formatDateTimeLocal = (
  date: Date,
  hour: string,
  minute: string,
  meridiem: Meridiem,
) => {
  const time24 = formatTimeCountdown(hour, minute, meridiem);
  if (!time24) return "";
  return `${formatPlainDate(date)}T${time24}`;
};

export type DateTimeDisplayParts = {
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
  meridiem: Meridiem;
  yearEntry?: string | null;
};

/** Fixed-width `MM/DD/YYYY hh:mm AM` display for segmented keyboard editing. */
export const formatDateTimeDisplay = ({
  month,
  day,
  year,
  hour,
  minute,
  meridiem,
  yearEntry = null,
}: DateTimeDisplayParts) => {
  const monthText = month ? pad2(month) : "mm";
  const dayText = day ? pad2(day) : "dd";
  const yearText =
    yearEntry !== null
      ? yearEntry.padEnd(4, "y")
      : /^\d{4}$/.test(year)
        ? year
        : "yyyy";
  const hourText = hour ? pad2(hour) : "hh";
  const minuteText = minute ? pad2(minute) : "mm";
  const meridiemText = meridiem || "aa";
  return `${monthText}/${dayText}/${yearText} ${hourText}:${minuteText} ${meridiemText}`;
};
