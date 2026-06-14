import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { cn } from "@/utils/cnHelper";

export type SearchableSelectOption = { label: string; value: string };

/**
 * Select with a built-in search box, for choosing one option from a potentially
 * long list (e.g. picking your name on the public schedule).
 */
const SearchableSelect = ({
  value,
  onChange,
  options,
  placeholder = "Select…",
  label,
  ariaLabel,
  className,
  variant = "light",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  className?: string;
  variant?: "light" | "board-attendee";
}) => {
  const isBoardAttendee = variant === "board-attendee";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter((option) => option.label.toLowerCase().includes(trimmed));
  }, [options, query]);

  return (
    <div className={className}>
      {label ? (
        <label
          className={cn(
            "block p-1 text-sm font-semibold",
            isBoardAttendee ? "text-stone-200" : "text-gray-700",
          )}
        >
          {label}
        </label>
      ) : null}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel || label}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm shadow-sm focus:outline-none focus:ring-2",
              isBoardAttendee
                ? "border-stone-600 bg-stone-900 text-stone-100 hover:border-stone-500 focus:ring-amber-500/40"
                : "border-gray-300 bg-white text-gray-900 hover:border-gray-400 focus:ring-amber-400/50",
            )}
          >
            <span
              className={cn(
                "truncate",
                !selected && (isBoardAttendee ? "text-stone-500" : "text-gray-400"),
              )}
            >
              {selected?.label || placeholder}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0",
                isBoardAttendee ? "text-stone-400" : "text-gray-400",
              )}
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className={cn(
            "w-[--radix-popover-trigger-width] min-w-52 rounded-md border p-0 shadow-xl",
            isBoardAttendee
              ? "border-stone-700 bg-stone-900 text-stone-100"
              : "border-gray-200 bg-white text-gray-900",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 border-b px-2 py-1.5",
              isBoardAttendee ? "border-stone-700" : "border-gray-200",
            )}
          >
            <Search
              className={cn(
                "h-4 w-4 shrink-0",
                isBoardAttendee ? "text-stone-400" : "text-gray-400",
              )}
              aria-hidden
            />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search…"
              className={cn(
                "w-full bg-transparent text-sm focus:outline-none",
                isBoardAttendee
                  ? "text-stone-100 placeholder:text-stone-500"
                  : "text-gray-900 placeholder:text-gray-400",
              )}
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p
                className={cn(
                  "px-2 py-1.5 text-sm",
                  isBoardAttendee ? "text-stone-500" : "text-gray-400",
                )}
              >
                No matches.
              </p>
            ) : null}
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm",
                  isBoardAttendee
                    ? "text-stone-100 hover:bg-stone-800"
                    : "text-gray-800 hover:bg-gray-100",
                )}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="truncate">{option.label}</span>
                {option.value === value ? (
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isBoardAttendee ? "text-amber-300" : "text-amber-600",
                    )}
                    aria-hidden
                  />
                ) : null}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default SearchableSelect;
