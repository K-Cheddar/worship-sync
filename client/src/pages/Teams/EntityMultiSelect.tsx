import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/utils/cnHelper";
import Input from "../../components/Input/Input";
import SelectAllButton from "../../components/SelectAllButton";
import { resolvePositionLucideIcon } from "./lucidePositionIcons";
import {
  boardFieldsetDescriptionClassName,
  boardFieldsetLegendClassName,
  boardIntakeFieldsetClassName,
} from "./teamsStyles";

export type EntityMultiSelectOption = {
  id: string;
  label: string;
  sublabel?: string;
  /** Lucide icon name for team positions. */
  icon?: string;
  archived?: boolean;
};

type EntityMultiSelectProps = {
  label: string;
  description?: string;
  options: EntityMultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Show the search box once there are at least this many options. */
  searchThreshold?: number;
  showSearch?: boolean;
  emptyText?: string;
  variant?: "admin" | "board-attendee";
  /** When set, sublabel renders above label with stronger visual weight (e.g. service dates). */
  emphasizeSublabel?: boolean;
};

/**
 * Vertical, large-hit-area multi-select list. Each option is a full-width
 * toggle row showing a cyan check when selected. Replaces cramped checkbox
 * grids for picking members/positions onto a team.
 */
const EntityMultiSelect = ({
  label,
  description,
  options,
  value,
  onChange,
  searchThreshold = 6,
  showSearch = true,
  emptyText = "Nothing to choose yet.",
  variant = "admin",
  emphasizeSublabel = false,
}: EntityMultiSelectProps) => {
  const [query, setQuery] = useState("");
  const isBoard = variant === "board-attendee";

  const selectableIds = useMemo(
    () => options.filter((option) => !option.archived || value.includes(option.id)).map((o) => o.id),
    [options, value],
  );

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(trimmed),
    );
  }, [options, query]);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => value.includes(id));

  return (
    <fieldset className={cn("min-w-0", isBoard && boardIntakeFieldsetClassName)}>
      <div className="flex items-center justify-between gap-2">
        <legend
          className={cn(
            isBoard ? boardFieldsetLegendClassName : "p-1 text-sm font-semibold",
          )}
        >
          {label}
          {value.length ? (
            <span
              className={cn(
                "ml-1 text-xs font-normal",
                isBoard ? "text-amber-300/80" : "text-cyan-300",
              )}
            >
              ({value.length} selected)
            </span>
          ) : null}
        </legend>
        {selectableIds.length > 0 ? (
          <SelectAllButton
            allSelected={allSelected}
            tone={isBoard ? "board-attendee" : "admin"}
            onClick={() => onChange(allSelected ? [] : selectableIds)}
          />
        ) : null}
      </div>
      {description ? (
        <p
          className={cn(
            "mb-2",
            isBoard ? boardFieldsetDescriptionClassName : "px-1 text-xs text-gray-400",
          )}
        >
          {description}
        </p>
      ) : null}
      {showSearch && options.length >= searchThreshold ? (
        <Input
          className="mb-2"
          label={`Search ${label}`}
          hideLabel
          placeholder={`Search ${label.toLowerCase()}…`}
          value={query}
          labelClassName={isBoard ? "text-stone-200" : undefined}
          inputClassName={
            isBoard
              ? "rounded-md border border-stone-600 bg-stone-900 text-stone-100 placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              : undefined
          }
          onChange={(next) => setQuery(String(next))}
        />
      ) : null}
      <div
        className={cn(
          isBoard ? "space-y-1" : "max-h-64 space-y-1 overflow-y-auto rounded-md border border-gray-700 bg-gray-950/60 p-2",
        )}
      >
        {options.length === 0 ? (
          <p className={cn("text-sm", isBoard ? "text-stone-400" : "text-gray-400")}>
            {emptyText}
          </p>
        ) : filtered.length === 0 ? (
          <p className={cn("text-sm", isBoard ? "text-stone-400" : "text-gray-400")}>
            No matches.
          </p>
        ) : (
          filtered.map((option) => {
            const checked = value.includes(option.id);
            const disabled = Boolean(option.archived) && !checked;
            const OptionIcon = resolvePositionLucideIcon(option.icon);
            return (
              <button
                key={option.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => toggle(option.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                  checked
                    ? isBoard
                      ? "bg-amber-400/10 text-stone-50 ring-1 ring-amber-400/20"
                      : "border border-cyan-400/60 bg-cyan-400/10 text-cyan-50"
                    : isBoard
                      ? "text-stone-100 hover:bg-stone-800/40"
                      : "border border-gray-700 bg-gray-950/40 text-gray-100 hover:border-gray-600 hover:bg-gray-800/60",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                    checked
                      ? isBoard
                        ? "border-amber-400 bg-amber-400 text-stone-950"
                        : "border-cyan-400 bg-cyan-400 text-gray-950"
                      : isBoard
                        ? "border-stone-600"
                        : "border-gray-600",
                  )}
                >
                  {checked ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : null}
                </span>
                {OptionIcon ? (
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded",
                      isBoard
                        ? "bg-amber-400/10 text-amber-200"
                        : "border border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
                    )}
                  >
                    <OptionIcon className="h-4 w-4" aria-hidden />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  {option.sublabel && emphasizeSublabel ? (
                    <>
                      <span
                        className={cn(
                          "block truncate text-base font-semibold leading-snug",
                          isBoard ? "text-stone-50" : "text-white",
                        )}
                      >
                        {option.sublabel}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-sm font-medium leading-snug",
                          isBoard ? "text-stone-300" : "text-gray-300",
                        )}
                      >
                        {option.label}
                        {option.archived ? " (archived)" : ""}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block truncate font-medium">
                        {option.label}
                        {option.archived ? " (archived)" : ""}
                      </span>
                      {option.sublabel ? (
                        <span
                          className={cn(
                            "block truncate text-xs",
                            isBoard ? "text-stone-400" : "text-gray-400",
                          )}
                        >
                          {option.sublabel}
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </fieldset>
  );
};

export default EntityMultiSelect;
