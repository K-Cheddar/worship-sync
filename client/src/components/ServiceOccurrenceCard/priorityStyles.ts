/** Shared up-next accent: ribbons, board cards, and service cards stay aligned. */
export const scheduleUpNextBorderClassName = "border-orange-400";
export const scheduleUpNextHeaderHighlightClassName =
  "border-b border-b-orange-400";

/** Shared Today accent: distinct from Up next for other services on the same day. */
export const scheduleTodayBorderClassName = "border-sky-400";
export const scheduleTodayHeaderHighlightClassName =
  "border-b border-b-sky-400";

/** Up next wins over Today when both apply; otherwise use Today. */
export const scheduleOccurrenceHeaderHighlightClassName = ({
  isNextUpcoming,
  isToday,
}: {
  isNextUpcoming: boolean;
  isToday: boolean;
}) => {
  if (isNextUpcoming) return scheduleUpNextHeaderHighlightClassName;
  if (isToday) return scheduleTodayHeaderHighlightClassName;
  return undefined;
};
