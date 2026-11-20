import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Button from "./Button/Button";

type SortDirection = "ascending" | "descending";

type SortableColumnButtonProps = {
  label: string;
  direction?: SortDirection;
  ariaLabel?: string;
  onClick: () => void;
};

/** The shared Resources and item-library sortable table header control. */
const SortableColumnButton = ({ label, direction, ariaLabel, onClick }: SortableColumnButtonProps) => (
  <Button
    type="button"
    variant="none"
    padding="p-0"
    className="flex max-md:min-h-0 cursor-pointer items-center gap-0.5 whitespace-normal text-left text-[11px] font-normal hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 md:gap-1 md:whitespace-nowrap md:text-sm"
    aria-label={ariaLabel ?? label}
    aria-pressed={Boolean(direction)}
    onClick={onClick}
  >
    <span>{label}</span>
    {direction === "ascending" ? <ArrowUp className="size-3.5 max-md:size-3" aria-hidden /> : null}
    {direction === "descending" ? <ArrowDown className="size-3.5 max-md:size-3" aria-hidden /> : null}
    {!direction ? <ArrowUpDown className="size-3.5 max-md:size-3" aria-hidden /> : null}
  </Button>
);

export default SortableColumnButton;
