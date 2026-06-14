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
}: ScheduleSlotContextHeaderProps) => (
  <div className={cn("shrink-0 space-y-2", className)}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-orange-300/90">
          Assigning
        </p>
        <p className="mt-0.5 text-sm font-semibold text-white">
          {positionLabel}
          <span className="font-normal text-gray-400"> · </span>
          {occurrenceLabel}
        </p>
        <p className="mt-0.5 text-xs text-gray-400">
          Current: {currentAssigneeLabel}
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
    <p className="text-xs text-gray-500">
      Pick a member below, or type in the slot.
    </p>
  </div>
);

export default ScheduleSlotContextHeader;
