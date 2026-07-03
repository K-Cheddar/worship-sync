import { useState } from "react";
import { ArrowUpDown, X } from "lucide-react";
import Button from "../../../components/Button/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { cn } from "@/utils/cnHelper";
import {
  formatScheduleMembersSortLabel,
  isDefaultScheduleMembersSort,
  type ScheduleMembersSort as ScheduleMembersSortState,
  type ScheduleMembersSortDirection,
  type ScheduleMembersSortField,
} from "../teamsUtils";

type ScheduleMembersSortProps = {
  value: ScheduleMembersSortState;
  onChange: (value: ScheduleMembersSortState) => void;
};

type SortDirectionOption = {
  direction: ScheduleMembersSortDirection;
  label: string;
};

type SortFieldGroup = {
  field: ScheduleMembersSortField;
  label: string;
  directions: SortDirectionOption[];
};

const SORT_FIELD_GROUPS: SortFieldGroup[] = [
  {
    field: "name",
    label: "Name",
    directions: [
      { direction: "asc", label: "A to Z (default)" },
      { direction: "desc", label: "Z to A" },
    ],
  },
  {
    field: "assignmentCount",
    label: "Times on schedule",
    directions: [
      { direction: "desc", label: "Most assigned first" },
      { direction: "asc", label: "Least assigned first" },
    ],
  },
];

const SortDirectionButton = ({
  selected,
  label,
  onSelect,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onSelect}
    className={cn(
      "flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors",
      selected
        ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-50"
        : "border-gray-700 bg-gray-950/40 text-gray-100 hover:border-gray-600 hover:bg-gray-800/60",
    )}
  >
    <span
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
        selected ? "border-cyan-400 bg-cyan-400 text-gray-950" : "border-gray-600",
      )}
    >
      {selected ? <span className="h-2 w-2 rounded-full bg-gray-950" /> : null}
    </span>
    <span className="min-w-0 truncate">{label}</span>
  </button>
);

const ScheduleMembersSort = ({
  value,
  onChange,
}: ScheduleMembersSortProps) => {
  const [open, setOpen] = useState(false);
  const isDefaultSort = isDefaultScheduleMembersSort(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="tertiary"
          svg={ArrowUpDown}
          iconSize="sm"
          className={cn(
            "shrink-0 justify-center",
            !isDefaultSort && "border-cyan-400/40 bg-cyan-400/10 text-cyan-50",
          )}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={
            isDefaultSort
              ? "Sort members"
              : `Sort members, ${formatScheduleMembersSortLabel(value)}`
          }
        >
          Sort
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-64 rounded-md border border-gray-700 bg-gray-900 p-3 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Sort by
          </p>
          <Button
            type="button"
            variant="tertiary"
            svg={X}
            iconSize="sm"
            padding="p-0.5"
            className="text-gray-400 hover:text-white"
            aria-label="Close sort options"
            onClick={() => setOpen(false)}
          />
        </div>
        <div className="mt-2 flex flex-col gap-3">
          {SORT_FIELD_GROUPS.map((group) => (
            <div key={group.field}>
              <p className="text-xs font-semibold text-gray-300">{group.label}</p>
              <div className="mt-1 flex flex-col gap-1">
                {group.directions.map((directionOption) => {
                  const selected =
                    value.field === group.field &&
                    value.direction === directionOption.direction;
                  return (
                    <SortDirectionButton
                      key={`${group.field}-${directionOption.direction}`}
                      selected={selected}
                      label={directionOption.label}
                      onSelect={() => {
                        onChange({
                          field: group.field,
                          direction: directionOption.direction,
                        });
                        setOpen(false);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ScheduleMembersSort;
