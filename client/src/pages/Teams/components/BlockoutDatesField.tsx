import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import Button from "../../../components/Button/Button";
import SegmentedControl from "../../../components/SegmentedControl/SegmentedControl";
import DatePicker from "@/components/ui/DatePicker";
import DateRangePicker from "@/components/ui/DateRangePicker";
import type { TeamIntakeBlockoutRange } from "../../../api/authTypes";
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
};

type BlockoutDatesFieldProps = {
  value: TeamIntakeBlockoutRange[];
  onChange: (ranges: TeamIntakeBlockoutRange[]) => void;
  label?: string;
  description?: string;
  /** Earliest selectable date, `yyyy-MM-dd` (the form period start). */
  min?: string;
  /** Latest selectable date, `yyyy-MM-dd` (the form period end). */
  max?: string;
  /** Styling for the date inputs, e.g. the dark board theme. */
  fieldClassName?: string;
  variant?: "admin" | "board-attendee";
};

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `blockout-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const itemToRange = (item: BlockoutItem): TeamIntakeBlockoutRange =>
  item.mode === "single"
    ? { startDate: item.startDate, endDate: item.startDate }
    : { startDate: item.startDate, endDate: item.endDate };

const rangeToItem = (range: TeamIntakeBlockoutRange): BlockoutItem => ({
  id: makeId(),
  mode: range.startDate === range.endDate ? "single" : "range",
  startDate: range.startDate,
  endDate: range.endDate,
});

/**
 * Blockout dates for a team intake form. Each entry is either a single day or an
 * explicit start → end range, so the submitter is never left guessing whether
 * two side-by-side dates form a range. Emits normalized
 * `{ startDate, endDate }` ranges (single days collapse to the same date).
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
}: BlockoutDatesFieldProps) => {
  const isBoard = variant === "board-attendee";
  const [items, setItems] = useState<BlockoutItem[]>(() => value.map(rangeToItem));

  const commit = (next: BlockoutItem[]) => {
    setItems(next);
    onChange(next.map(itemToRange));
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
                variant="tertiary"
                svg={X}
                aria-label="Remove blockout"
                className={cn(
                  isBoard
                    ? "text-stone-300 hover:bg-stone-800/60"
                    : "rounded-md border border-stone-600/80 bg-stone-900/60 text-stone-200 hover:bg-stone-800/80",
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
                { id: makeId(), mode: "single", startDate: "", endDate: "" },
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
                { id: makeId(), mode: "range", startDate: "", endDate: "" },
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
