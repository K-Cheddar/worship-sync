import { ClipboardList } from "lucide-react";
import Button from "../../../components/Button/Button";
import { cn } from "@/utils/cnHelper";

export const scheduleOccurrenceDateButtonClassName =
  "w-full border border-cyan-400/35 bg-cyan-500/10 text-left text-sm font-medium text-cyan-50 hover:border-cyan-400/55 hover:bg-cyan-500/15 hover:text-white max-md:min-h-0";

const ScheduleOccurrenceDateButton = ({
  label,
  ariaLabel,
  onClick,
  className,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  className?: string;
}) => (
  <Button
    type="button"
    variant="tertiary"
    svg={ClipboardList}
    iconSize="sm"
    padding="px-2 py-1"
    color="#67e8f9"
    truncate
    className={cn(scheduleOccurrenceDateButtonClassName, className)}
    aria-label={ariaLabel}
    onClick={onClick}
  >
    {label}
  </Button>
);

export default ScheduleOccurrenceDateButton;
