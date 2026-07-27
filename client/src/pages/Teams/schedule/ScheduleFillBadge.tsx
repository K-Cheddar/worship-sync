import { cn } from "@/utils/cnHelper";

/**
 * Compact "filled/required" indicator shown on every schedule layout's service
 * header. Amber until every required slot has a primary member, then green.
 * Renders nothing when the occurrence requires no positions. Pass `showLabel` to
 * spell out what the numbers mean (used where there is room, like the board's
 * team line); the grids use the bare count.
 */
const ScheduleFillBadge = ({
  filled,
  required,
  showLabel = false,
  className,
}: {
  filled: number;
  required: number;
  showLabel?: boolean;
  className?: string;
}) => {
  if (required === 0) return null;
  const complete = filled >= required;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums",
        complete ? "text-emerald-300" : "text-amber-300",
        className,
      )}
      aria-label={`${filled} of ${required} positions filled`}
    >
      {filled}/{required}
      {showLabel ? <span>filled</span> : null}
    </span>
  );
};

export default ScheduleFillBadge;
