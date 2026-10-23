import { useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import SegmentedControl from "../../../components/SegmentedControl/SegmentedControl";
import DatePicker from "@/components/ui/DatePicker";
import DateRangePicker from "@/components/ui/DateRangePicker";
import type { TeamBlockoutDateRange } from "../../../api/authTypes";
import { parsePlainDate } from "../../../utils/plainDate";
import { formatBlockoutDateRangeLabel } from "../teamsUtils";
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
  variant?: "admin" | "board-attendee" | "volunteer";
  /** Show an optional free-form notes input per entry (admin roster editing). */
  showNotes?: boolean;
  /** Keep the owning editor from replacing a row while it is being edited. */
  onEditingChange?: (editing: boolean) => void;
  /** Muted message shown when there are no entries yet. */
  emptyLabel?: string;
  /** Prevent edits while the owning form is saving. */
  disabled?: boolean;
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
  mode: range.endDate === undefined || range.startDate === range.endDate ? "single" : "range",
  startDate: range.startDate,
  endDate: range.endDate === undefined ? range.startDate : range.endDate,
  notes: range.notes || "",
});

export const isValidBlockoutDateRange = (
  range: TeamBlockoutDateRange,
): boolean => {
  const endDate = range.endDate === undefined ? range.startDate : range.endDate;
  if (!endDate) return false;
  const isPlainDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Boolean(parsePlainDate(value));
  return Boolean(
    isPlainDate(range.startDate) &&
      isPlainDate(endDate) &&
      range.startDate <= endDate,
  );
};

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
  onEditingChange,
  emptyLabel,
  disabled = false,
}: BlockoutDatesFieldProps) => {
  const isBoard = variant === "board-attendee";
  const isVolunteer = variant === "volunteer";
  const [items, setItems] = useState<BlockoutItem[]>(() => value.map(rangeToItem));
  const [editingId, setEditingId] = useState<string | null>(() => {
    return items.find((item) => !isValidBlockoutDateRange(itemToRange(item, showNotes)))?.id || null;
  });
  const changeEditingId = (id: string | null) => {
    setEditingId(id);
    onEditingChange?.(id !== null);
  };

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

  const removeItem = (item: BlockoutItem) => {
    const next = items.filter((other) => other.id !== item.id);
    commit(next);
    if (isVolunteer && editingId === item.id) {
      changeEditingId(next.find((other) => !isValidBlockoutDateRange(itemToRange(other, showNotes)))?.id || null);
    }
  };

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
      <div className={cn("space-y-3", isVolunteer && "max-w-3xl")}>
        {items.length === 0 && emptyLabel ? (
          <p className="text-sm text-gray-400">{emptyLabel}</p>
        ) : null}
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "space-y-3 rounded-lg",
              isVolunteer
                ? "border border-gray-700/80 bg-gray-950/30 p-2.5"
                : "p-3",
              !isVolunteer && (isBoard ? "bg-stone-950/40" : "border border-stone-700 bg-stone-950/60"),
            )}
          >
            {isVolunteer && editingId !== item.id ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-100">
                    {isValidBlockoutDateRange(itemToRange(item, showNotes))
                      ? formatBlockoutDateRangeLabel(itemToRange(item, showNotes))
                      : "Choose valid dates"}
                  </p>
                  {showNotes && item.notes ? (
                    <p className="mt-0.5 break-words text-xs text-gray-400">{item.notes}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={Pencil}
                    iconSize="xs"
                    disabled={disabled}
                    aria-label={`Edit time off: ${isValidBlockoutDateRange(itemToRange(item, showNotes)) ? formatBlockoutDateRangeLabel(itemToRange(item, showNotes)) : "choose dates"}`}
                    className="min-h-[40px] px-2 text-xs max-md:min-h-[44px]"
                    onClick={() => changeEditingId(item.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={X}
                    iconSize="xs"
                    disabled={disabled}
                    aria-label={`Remove blockout ${isValidBlockoutDateRange(itemToRange(item, showNotes)) ? formatBlockoutDateRangeLabel(itemToRange(item, showNotes)) : "without dates"}`}
                    className="min-h-[40px] px-2 text-xs text-gray-300 hover:text-white max-md:min-h-[44px]"
                    onClick={() => removeItem(item)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <SegmentedControl
                    ariaLabel="Blockout type"
                    variant="muted"
                    value={item.mode}
                    disabled={disabled}
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
                    disabled={disabled}
                    aria-label={isVolunteer
                      ? `Remove blockout ${isValidBlockoutDateRange(itemToRange(item, showNotes)) ? formatBlockoutDateRangeLabel(itemToRange(item, showNotes)) : "without dates"}`
                      : "Remove blockout"}
                    className={cn(
                      "shrink-0 self-center",
                      isBoard
                        ? "text-stone-300 hover:bg-stone-800/60"
                        : "text-gray-400 hover:text-white",
                    )}
                    onClick={() => removeItem(item)}
                  />
                </div>

                {item.mode === "single" ? (
                  <DatePicker
                    label="Day you're away"
                    value={item.startDate}
                    disabled={disabled}
                    min={min}
                    max={max}
                    inputClassName={fieldClassName}
                    onChange={(startDate) => updateItem(item.id, { startDate, endDate: startDate })}
                  />
                ) : (
                  <DateRangePicker
                    label="Dates you're away"
                    value={{ startDate: item.startDate, endDate: item.endDate }}
                    disabled={disabled}
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
                    disabled={disabled}
                    inputClassName={fieldClassName}
                    onChange={(notes) =>
                      updateItem(item.id, { notes: String(notes) })
                    }
                  />
                ) : null}
              </>
            )}
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            svg={Plus}
            iconSize="sm"
            disabled={disabled}
            onClick={() => {
              const item = { id: makeId(), mode: "single" as const, startDate: "", endDate: "", notes: "" };
              commit([...items, item]);
              if (isVolunteer) changeEditingId(item.id);
            }}
          >
            Add single day
          </Button>
          <Button
            variant="secondary"
            svg={Plus}
            iconSize="sm"
            disabled={disabled}
            onClick={() => {
              const item = { id: makeId(), mode: "range" as const, startDate: "", endDate: "", notes: "" };
              commit([...items, item]);
              if (isVolunteer) changeEditingId(item.id);
            }}
          >
            Add date range
          </Button>
        </div>
      </div>
    </fieldset>
  );
};

export default BlockoutDatesField;
