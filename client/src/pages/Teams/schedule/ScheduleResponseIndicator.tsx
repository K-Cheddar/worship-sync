import { Check, Minus, X } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import type { AssignmentResponse } from "./scheduleResponseState";

/**
 * One tone per response state, shared by the grid, the board card, and the
 * volunteer's own page.
 *
 * Colours are defined once here because the same fact is shown on three
 * surfaces: if an owner's grid said green and the volunteer's page said
 * something else for the same answer, neither would be trusted.
 *
 * **Declined is red, not amber**, even though amber would read as gentler.
 * Amber already means "blocked out" on these cells, and two amber markers a few
 * pixels apart that mean different things is worse than a strong colour. Red
 * here means "this slot is not covered", which is exactly what a decline is.
 */
export const SCHEDULE_RESPONSE_TONE: Record<
  AssignmentResponse,
  { icon: typeof Check; className: string; label: string }
> = {
  accepted: { icon: Check, className: "text-emerald-300", label: "Accepted" },
  declined: { icon: X, className: "text-red-400", label: "Declined" },
  pending: { icon: Minus, className: "text-gray-500", label: "No response" },
};

/**
 * A response marker for a filled slot.
 *
 * Pending is drawn rather than left blank: an empty space cannot be told apart
 * from "this surface does not show responses", and the whole point is that an
 * owner can see at a glance who has not answered.
 */
const ScheduleResponseIndicator = ({
  response,
  memberName,
  className,
}: {
  response: AssignmentResponse;
  /** Used for the accessible label so a screen reader hears whose answer it is. */
  memberName?: string;
  className?: string;
}) => {
  const tone = SCHEDULE_RESPONSE_TONE[response];
  const Glyph = tone.icon;
  const label = memberName ? `${memberName}: ${tone.label}` : tone.label;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-flex shrink-0 items-center", tone.className, className)}
    >
      <Glyph className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
};

export default ScheduleResponseIndicator;
