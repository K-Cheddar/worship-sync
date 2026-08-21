/** Shift a YYYY-MM-DD day key by `deltaDays` using UTC calendar math. */
export const shiftDayKey = (dayKey: string, deltaDays: number) => {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
};

export const earliestDayKey = (todayKey: string, retentionDays: number) =>
  shiftDayKey(todayKey, -retentionDays);

const DAYS_PER_WEEK = 7;

/** Shift a chat week key (the Sunday starting that week) by `deltaWeeks`. */
export const shiftWeekKey = (weekKey: string, deltaWeeks: number) =>
  shiftDayKey(weekKey, deltaWeeks * DAYS_PER_WEEK);

/** Snap any YYYY-MM-DD date to the Sunday that starts its week. */
export const weekStartKey = (dayKey: string) => {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  return shiftDayKey(dayKey, -date.getUTCDay());
};

// `dayKey` here is really a week key (the Sunday that starts the church-local
// week) — chat is segmented by week, not by calendar day.
export const formatChatDayLabel = (
  dayKey: string,
  todayKey: string,
  timeZone: string,
) => {
  if (dayKey === todayKey) return "This week";
  const lastWeekKey = shiftWeekKey(todayKey, -1);
  if (dayKey === lastWeekKey) return "Last week";
  const start = new Date(`${dayKey}T12:00:00.000Z`);
  const end = new Date(`${shiftDayKey(dayKey, DAYS_PER_WEEK - 1)}T12:00:00.000Z`);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(start);
  const endLabel = new Intl.DateTimeFormat(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    timeZone,
  }).format(end);
  return `${startLabel}–${endLabel}`;
};
