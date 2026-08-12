/** Shift a YYYY-MM-DD day key by `deltaDays` using UTC calendar math. */
export const shiftDayKey = (dayKey: string, deltaDays: number) => {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
};

export const earliestDayKey = (todayKey: string, retentionDays: number) =>
  shiftDayKey(todayKey, -retentionDays);

export const formatChatDayLabel = (
  dayKey: string,
  todayKey: string,
  timeZone: string,
) => {
  if (dayKey === todayKey) return "Today";
  const yesterdayKey = shiftDayKey(todayKey, -1);
  if (dayKey === yesterdayKey) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date(`${dayKey}T12:00:00.000Z`));
};
