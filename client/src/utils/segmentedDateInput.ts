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

export type DateRangeEndpoint = "start" | "end";

export type DateRangeField = `${DateRangeEndpoint}-${DateSegment}`;

/** Character index where the end date begins in `MM/DD/YYYY – MM/DD/YYYY`. */
export const DATE_RANGE_END_OFFSET = 13;

export const DATE_RANGE_FIELD_ORDER: DateRangeField[] = [
  "start-month",
  "start-day",
  "start-year",
  "end-month",
  "end-day",
  "end-year",
];

export const parseDateRangeField = (
  field: DateRangeField,
): { endpoint: DateRangeEndpoint; segment: DateSegment } => {
  const [endpoint, segment] = field.split("-") as [
    DateRangeEndpoint,
    DateSegment,
  ];
  return { endpoint, segment };
};

export const getDateRangeFieldRange = (
  field: DateRangeField,
): [number, number] => {
  const { endpoint, segment } = parseDateRangeField(field);
  const offset = endpoint === "start" ? 0 : DATE_RANGE_END_OFFSET;
  const [start, end] = DATE_SEGMENT_RANGES[segment];
  return [start + offset, end + offset];
};

export const getDateRangeFieldFromPos = (pos: number): DateRangeField => {
  if (pos <= 9) {
    return `start-${getDateSegmentFromPos(pos)}`;
  }
  if (pos <= 12) {
    return pos <= 10 ? "start-year" : "end-month";
  }
  return `end-${getDateSegmentFromPos(pos - DATE_RANGE_END_OFFSET)}`;
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

/** Fixed-width `MM/DD/YYYY – MM/DD/YYYY` display for segmented keyboard editing. */
export const formatSegmentedDateRangeDisplay = (
  start: SegmentedDateDisplayParts,
  end: SegmentedDateDisplayParts,
) =>
  `${formatSegmentedDateDisplay(start)} – ${formatSegmentedDateDisplay(end)}`;
