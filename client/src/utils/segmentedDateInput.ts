import { pad2 } from "../constants";

export type DateSegment = "month" | "day" | "year";

export const DATE_SEGMENT_RANGES: Record<DateSegment, [number, number]> = {
  month: [0, 2],
  day: [3, 5],
  year: [6, 10],
};

export const DATE_SEGMENT_ORDER: DateSegment[] = ["month", "day", "year"];

export const getDateSegmentFromPos = (pos: number): DateSegment => {
  if (pos <= 1) return "month";
  if (pos <= 4) return "day";
  return "year";
};

export const daysInMonth = (month: number, year: number) =>
  new Date(year, month, 0).getDate();

/** Build a local Date from MM/DD/YYYY segments when all parts are valid. */
export const buildDateFromParts = (
  month: string,
  day: string,
  year: string,
): Date | undefined => {
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

export type SegmentedDateDisplayParts = {
  month: string;
  day: string;
  year: string;
  yearEntry?: string | null;
};

/** Fixed-width `MM/DD/YYYY` display for segmented keyboard editing. */
export const formatSegmentedDateDisplay = ({
  month,
  day,
  year,
  yearEntry = null,
}: SegmentedDateDisplayParts) => {
  const monthText = month ? pad2(month) : "mm";
  const dayText = day ? pad2(day) : "dd";
  const yearText =
    yearEntry !== null
      ? yearEntry.padEnd(4, "y")
      : /^\d{4}$/.test(year)
        ? year
        : "yyyy";
  return `${monthText}/${dayText}/${yearText}`;
};
