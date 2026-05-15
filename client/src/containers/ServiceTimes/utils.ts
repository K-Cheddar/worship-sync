import { MonthWeekOrdinal, MultiWeeklyDay, Weekday } from "../../types";

const DAY_ABBRS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const weekdays: { label: string; value: Weekday }[] = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
];

export const ordinals: { label: string; value: MonthWeekOrdinal }[] = [
  { label: "1st", value: 1 },
  { label: "2nd", value: 2 },
  { label: "3rd", value: 3 },
  { label: "4th", value: 4 },
  { label: "5th (last)", value: 5 },
];

export const formatOneTime = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${dateStr} @ ${timeStr}`;
};

export const to12Hour = (hhmm?: string) => {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr || "0", 10);
  const m = parseInt(mStr || "0", 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = String(m).padStart(2, "0");
  return `${h}:${mm} ${ampm}`;
};

export const parseDateOnlyAsLocalDate = (dateStr?: string) => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr
    .split("-")
    .map((part) => parseInt(part, 10));
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    return null;
  }
  return new Date(year, month - 1, day);
};

export const formatWeekly = (dow?: Weekday, hhmm?: string) => {
  const day = weekdays.find((w) => w.value === dow)?.label || "";
  return `${day}${day ? "s" : ""} @ ${to12Hour(hhmm)}`;
};

export const formatMultiWeekly = (
  days?: MultiWeeklyDay[],
  endDateISO?: string,
) => {
  if (!days?.length) return "";

  // Sort by day so groups are in week order
  const sorted = [...days].sort((a, b) => a.day - b.day);

  // Group days that share a time; Map preserves insertion (= earliest-day) order
  const byTime = new Map<string, Weekday[]>();
  for (const { day, time } of sorted) {
    const group = byTime.get(time);
    if (group) group.push(day);
    else byTime.set(time, [day]);
  }

  // Sort groups by the earliest day each contains
  const groups = [...byTime.entries()].sort(([, a], [, b]) => a[0] - b[0]);

  const endDate = parseDateOnlyAsLocalDate(endDateISO);
  const endStr = endDate
    ? ` until ${endDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
    : "";

  return (
    groups
      .map(([t, groupDays]) => `${groupDays.map((d) => DAY_ABBRS[d]).join(", ")} @ ${to12Hour(t)}`)
      .join(", ") + endStr
  );
};

export const formatMonthly = (
  ord?: MonthWeekOrdinal,
  w?: Weekday,
  hhmm?: string
) => {
  const ordLabel =
    ord === 5
      ? "last"
      : ordinals.find((o) => o.value === ord)?.label?.replace(" (last)", "");
  const day = weekdays.find((wd) => wd.value === w)?.label || "";
  if (!ordLabel || !day) return "";
  const timeStr = to12Hour(hhmm);
  return `Every ${ordLabel === "last" ? "last" : ordLabel} ${day}${timeStr ? ` @ ${timeStr}` : ""}`;
};
