import ScheduleTodayBadge from "./ScheduleTodayBadge";
import ScheduleUpNextBadge from "./ScheduleUpNextBadge";

type ScheduleOccurrenceRibbonProps = {
  isNextUpcoming: boolean;
  isToday: boolean;
};

/**
 * Absolute top-center ribbon for board cards and plan/My Schedule tiles.
 * Up next takes precedence over Today when both would apply.
 */
const ScheduleOccurrenceRibbon = ({
  isNextUpcoming,
  isToday,
}: ScheduleOccurrenceRibbonProps) => {
  if (isNextUpcoming) {
    return (
      <div className="pointer-events-none absolute -top-2.5 left-1/2 z-20 -translate-x-1/2">
        <ScheduleUpNextBadge />
      </div>
    );
  }
  if (isToday) {
    return (
      <div className="pointer-events-none absolute -top-2.5 left-1/2 z-20 -translate-x-1/2">
        <ScheduleTodayBadge />
      </div>
    );
  }
  return null;
};

export default ScheduleOccurrenceRibbon;
