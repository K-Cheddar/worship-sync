import { useMemo, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

import { cn } from "@/utils/cnHelper";
import Button from "../../components/Button/Button";
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
  /** Matches an entry in `groups` so the option can be filtered by it (e.g. its team). */
  groupId?: string;
};

/** A filter chip scoping the list to one slice of the options (e.g. one team). */
export type EntityMultiSelectGroup = {
  id: string;
  label: string;
};

type EntityMultiSelectProps = {
  label: string;
  /** Hide the field legend when the parent already provides the section heading. */
  hideLabel?: boolean;
  /** Hide the built-in Select all control when the parent places it elsewhere. */
  hideSelectAll?: boolean;
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
  /** Trailing control per option (e.g. cross-section Edit link). Rendered outside the toggle. */
  renderOptionAction?: (option: EntityMultiSelectOption) => ReactNode;
  /** Filter chips shown above the list; each scopes it to options with that `groupId`. */
  groups?: EntityMultiSelectGroup[];
  /** Accessible name for the chip row, e.g. "Filter positions by team". */
  groupFilterLabel?: string;
  /** Chip label that clears the group filter. */
  allGroupsLabel?: string;
};

/**
 * Vertical, large-hit-area multi-select list. Each option is a full-width
 * toggle row showing a cyan check when selected. Replaces cramped checkbox
 * grids for picking members/positions onto a team.
 */
const EntityMultiSelect = ({
  label,
  hideLabel = false,
  hideSelectAll = false,
  description,
  options,
  value,
  onChange,
  searchThreshold = 6,
  showSearch = true,
  emptyText = "Nothing to choose yet.",
  variant = "admin",
  emphasizeSublabel = false,
  renderOptionAction,
  groups,
  groupFilterLabel,
  allGroupsLabel = "All",
}: EntityMultiSelectProps) => {
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const isBoard = variant === "board-attendee";

  const groupChips = groups && groups.length > 1 ? groups : undefined;
  // Ignore a stale selection if the group disappears (e.g. its team was removed)
  // so the list can never filter down to nothing the operator can't undo.
  const activeGroupId =
    groupId && groupChips?.some((group) => group.id === groupId) ? groupId : null;

  // Everything the group filter allows; search narrows this further for display,
  // while Select all / Clear all stays scoped to the visible group.
  const scopedOptions = useMemo(
    () =>
      activeGroupId
        ? options.filter((option) => option.groupId === activeGroupId)
        : options,
    [activeGroupId, options],
  );

  const selectableIds = useMemo(
    () => scopedOptions.filter((option) => !option.archived || value.includes(option.id)).map((o) => o.id),
    [scopedOptions, value],
  );

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return scopedOptions;
    return scopedOptions.filter((option) =>
      option.label.toLowerCase().includes(trimmed),
    );
  }, [scopedOptions, query]);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => value.includes(id));

  // Selections outside the active group are left untouched by Select all / Clear all.
  const toggleSelectAll = () => {
    if (allSelected) {
      const scoped = new Set(selectableIds);
      onChange(value.filter((id) => !scoped.has(id)));
      return;
    }
    onChange([...value, ...selectableIds.filter((id) => !value.includes(id))]);
  };

  return (
    // The legend sits inside the header row (so Select all can sit beside it),
    // which means it is not the fieldset's caption and contributes no
    // accessible name. Name the group explicitly so screen readers and tests
    // can tell one list from another.
    <fieldset
      className={cn("min-w-0", isBoard && boardIntakeFieldsetClassName)}
      aria-label={label}
    >
      {hideLabel ? (
        !hideSelectAll && selectableIds.length > 0 ? (
          <div className="flex justify-end">
            <SelectAllButton
              allSelected={allSelected}
              tone={isBoard ? "board-attendee" : "admin"}
              onClick={toggleSelectAll}
            />
          </div>
        ) : null
      ) : (
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
          {!hideSelectAll && selectableIds.length > 0 ? (
            <SelectAllButton
              allSelected={allSelected}
              tone={isBoard ? "board-attendee" : "admin"}
              onClick={toggleSelectAll}
            />
          ) : null}
        </div>
      )}
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
      {groupChips ? (
        <div
          className="mb-2 flex flex-wrap gap-1.5"
          role="group"
          aria-label={groupFilterLabel || `Filter ${label.toLowerCase()}`}
        >
          {[{ id: null, label: allGroupsLabel }, ...groupChips].map((group) => {
            const selected = activeGroupId === group.id;
            return (
              <Button
                key={group.id ?? "__all"}
                type="button"
                variant="tertiary"
                isSelected={selected}
                aria-pressed={selected}
                truncate
                padding="px-2 py-1"
                className={cn(
                  "text-xs max-md:min-h-11",
                  selected &&
                  (isBoard
                    ? "border border-amber-400/50 bg-amber-400/10 text-amber-100"
                    : "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100"),
                )}
                onClick={() => setGroupId(group.id)}
              >
                {group.label}
              </Button>
            );
          })}
        </div>
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
            const optionAction = renderOptionAction?.(option);
            return (
              <div
                key={option.id}
                className={cn(
                  "flex items-stretch gap-1 rounded-md",
                  checked
                    ? isBoard
                      ? "bg-amber-400/10 text-stone-50 ring-1 ring-amber-400/20"
                      : "border border-cyan-400/60 bg-cyan-400/10 text-cyan-50"
                    : isBoard
                      ? "text-stone-100"
                      : "border border-gray-700 bg-gray-950/40 text-gray-100",
                  disabled && "opacity-50",
                )}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={disabled}
                  onClick={() => toggle(option.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-start gap-3 px-2.5 py-2 text-left text-sm transition-colors",
                    !disabled &&
                    (isBoard
                      ? "hover:bg-stone-800/40"
                      : "hover:bg-gray-800/60"),
                    disabled && "cursor-not-allowed",
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
                {optionAction ? (
                  <div className="flex shrink-0 items-center pr-2">{optionAction}</div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </fieldset>
  );
};

export default EntityMultiSelect;
