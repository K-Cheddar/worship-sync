import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import SegmentedControl from "../../../components/SegmentedControl/SegmentedControl";
import DatePicker from "@/components/ui/DatePicker";
import DateRangePicker from "@/components/ui/DateRangePicker";
import type { TeamBlockoutDateRange } from "../../../api/authTypes";
import {
  boardFieldsetDescriptionClassName,
  boardFieldsetLegendClassName,
  boardIntakeFieldsetClassName,
} from "../teamsStyles";

type BlockoutMode = "single" | "range";

type BlockoutItem = {
  id: string;
  mode: BlockoutMode;
  startDate: string;
  endDate: string;
  notes: string;
};

type BlockoutDatesFieldProps = {
  value: TeamBlockoutDateRange[];
  onChange: (ranges: TeamBlockoutDateRange[]) => void;
  label?: string;
  description?: string;
  /** Earliest selectable date, `yyyy-MM-dd` (the form period start). */
  min?: string;
  /** Latest selectable date, `yyyy-MM-dd` (the form period end). */
  max?: string;
  /** Styling for the date inputs, e.g. the dark board theme. */
  fieldClassName?: string;
  variant?: "admin" | "board-attendee";
  /** Show an optional free-form notes input per entry (admin roster editing). */
  showNotes?: boolean;
  /** Muted message shown when there are no entries yet. */
  emptyLabel?: string;
};

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blockout-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const itemToRange = (
  item: BlockoutItem,
  showNotes: boolean,
): TeamBlockoutDateRange => {
  const endDate = item.mode === "single" ? item.startDate : item.endDate;
  const range: TeamBlockoutDateRange = { startDate: item.startDate, endDate };
  if (showNotes && item.notes) range.notes = item.notes;
  return range;
};

const rangeToItem = (range: TeamBlockoutDateRange): BlockoutItem => ({
  id: makeId(),
  mode: range.startDate === range.endDate ? "single" : "range",
  startDate: range.startDate,
  endDate: range.endDate,
  notes: range.notes || "",
});

/**
 * Blockout dates for team intake forms and admin roster editing. Each entry is
 * either a single day or an explicit start → end range, so the user is never
 * left guessing whether two side-by-side dates form a range. Emits normalized
 * `{ startDate, endDate }` ranges (single days collapse to the same date), with
 * optional per-entry `notes` when `showNotes` is set.
 */
const BlockoutDatesField = ({
  value,
  onChange,
  label,
  description,
  min,
  max,
  fieldClassName,
  variant = "board-attendee",
  showNotes = false,
  emptyLabel,
}: BlockoutDatesFieldProps) => {
  const isBoard = variant === "board-attendee";
  const [items, setItems] = useState<BlockoutItem[]>(() => value.map(rangeToItem));

  const commit = (next: BlockoutItem[]) => {
    setItems(next);
    onChange(next.map((item) => itemToRange(item, showNotes)));
  };

  const updateItem = (id: string, patch: Partial<BlockoutItem>) =>
    commit(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const setMode = (item: BlockoutItem, mode: BlockoutMode) =>
    updateItem(
      item.id,
      mode === "single"
        ? { mode, endDate: item.startDate }
        : { mode, endDate: item.endDate || item.startDate },
    );

  const blockoutModeOptions = [
    { value: "single" as const, label: "Single day" },
    { value: "range" as const, label: "Date range" },
  ];

  return (
    <fieldset className={cn(isBoard && label && boardIntakeFieldsetClassName)}>
      {label ? (
        <legend className={isBoard ? boardFieldsetLegendClassName : "p-1 text-sm font-semibold"}>
          {label}
        </legend>
      ) : null}
      {description ? (
        <p
          className={cn(
            isBoard ? cn(boardFieldsetDescriptionClassName, "pb-2") : "px-1 pb-2 text-xs text-gray-400",
          )}
        >
          {description}
        </p>
      ) : null}
      <div className="space-y-3">
        {items.length === 0 && emptyLabel ? (
          <p className="text-sm text-gray-400">{emptyLabel}</p>
        ) : null}
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "space-y-3 rounded-lg p-3",
              isBoard ? "bg-stone-950/40" : "border border-stone-700 bg-stone-950/60",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <SegmentedControl
                ariaLabel="Blockout type"
                variant="muted"
                value={item.mode}
                onChange={(mode) => setMode(item, mode)}
                options={blockoutModeOptions}
                className={isBoard ? "border-0" : undefined}
              />
              <Button
                type="button"
                variant="tertiary"
                svg={X}
                iconSize="sm"
                padding="p-0"
                aria-label="Remove blockout"
                className={cn(
                  "shrink-0 self-center",
                  isBoard
                    ? "text-stone-300 hover:bg-stone-800/60"
                    : "text-gray-400 hover:text-white",
                )}
                onClick={() => commit(items.filter((other) => other.id !== item.id))}
              />
            </div>

            {item.mode === "single" ? (
              <DatePicker
                label="Day you're away"
                value={item.startDate}
                min={min}
                max={max}
                inputClassName={fieldClassName}
                onChange={(startDate) => updateItem(item.id, { startDate })}
              />
            ) : (
              <DateRangePicker
                label="Dates you're away"
                value={{ startDate: item.startDate, endDate: item.endDate }}
                min={min}
                max={max}
                inputClassName={fieldClassName}
                onChange={({ startDate, endDate }) =>
                  updateItem(item.id, { startDate, endDate })
                }
              />
            )}

            {showNotes ? (
              <Input
                label="Notes"
                hideLabel
                placeholder="Notes (optional)"
                value={item.notes}
                inputClassName={fieldClassName}
                onChange={(notes) =>
                  updateItem(item.id, { notes: String(notes) })
                }
              />
            ) : null}
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            svg={Plus}
            iconSize="sm"
            onClick={() =>
              commit([
                ...items,
                { id: makeId(), mode: "single", startDate: "", endDate: "", notes: "" },
              ])
            }
          >
            Add single day
          </Button>
          <Button
            variant="secondary"
            svg={Plus}
            iconSize="sm"
            onClick={() =>
              commit([
                ...items,
                { id: makeId(), mode: "range", startDate: "", endDate: "", notes: "" },
              ])
            }
          >
            Add date range
          </Button>
        </div>
      </div>
    </fieldset>
  );
};

export default BlockoutDatesField;
