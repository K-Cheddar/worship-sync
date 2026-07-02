import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, Check, X } from "lucide-react";
import Button from "../../../components/Button/Button";
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
  panelRef: RefObject<HTMLElement | null>;
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
      { direction: "asc", label: "A to Z" },
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
  panelRef,
}: ScheduleMembersSortProps) => {
  const [open, setOpen] = useState(false);
  const isDefaultSort = isDefaultScheduleMembersSort(value);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const overlay =
    open && panelRef.current
      ? createPortal(
        <div
          role="dialog"
          aria-label="Sort members"
          className="absolute inset-0 z-20 flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-2">
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
          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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
                        onSelect={() =>
                          onChange({
                            field: group.field,
                            direction: directionOption.direction,
                          })
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="primary"
            svg={Check}
            iconSize="sm"
            color="#22d3ee"
            className="mt-3 shrink-0 w-full justify-center text-sm"
            onClick={() => setOpen(false)}
          >
            Apply
          </Button>
        </div>,
        panelRef.current,
      )
      : null;

  return (
    <>
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
        onClick={() => setOpen((current) => !current)}
      >
        Sort
      </Button>
      {overlay}
    </>
  );
};

export default ScheduleMembersSort;
