import Button from "../../../components/Button/Button";
import { cn } from "@/utils/cnHelper";

type ScheduleSlotContextHeaderProps = {
  positionLabel: string;
  occurrenceLabel: string;
  currentAssigneeLabel: string;
  onDone: () => void;
  className?: string;
};

const ScheduleSlotContextHeader = ({
  positionLabel,
  occurrenceLabel,
  currentAssigneeLabel,
  onDone,
  className,
}: ScheduleSlotContextHeaderProps) => {
  const hasAssignee = currentAssigneeLabel !== "Empty";

  return (
    <div className={cn("shrink-0 space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-orange-300/90">
            Assigning
          </p>
          <p className="min-w-0 text-sm font-semibold text-white">
            {positionLabel}
            <span className="font-normal text-gray-400"> · </span>
            {occurrenceLabel}
          </p>
        </div>
        <Button
          type="button"
          variant="tertiary"
          padding="px-2 py-1"
          className="shrink-0 text-xs"
          onClick={onDone}
        >
          Done
        </Button>
      </div>

      <div className="rounded-md text-center bg-orange-400/10 px-2.5 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-300/90">
          Current assignee
        </p>
        <p
          className={cn(
            "mt-0.5 break-words text-base font-semibold leading-snug",
            hasAssignee ? "text-white" : "text-gray-400 italic",
          )}
        >
          {currentAssigneeLabel}
        </p>
      </div>

      <p className="text-xs text-gray-500">
        Pick a member below, or type in the slot.
      </p>
    </div>
  );
};

export default ScheduleSlotContextHeader;
