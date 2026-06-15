import { useMemo, useState } from "react";

import { cn } from "@/utils/cnHelper";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import Input from "../../components/Input/Input";
import Button from "../../components/Button/Button";
import {
  CURATED_ROLE_ICONS,
  getAllLucideIcons,
  resolvePositionLucideIcon,
} from "./lucidePositionIcons";

const SEARCH_RESULT_LIMIT = 60;

type PositionIconPickerProps = {
  label?: string;
  value: string;
  onChange: (iconName: string) => void;
};

const IconButton = ({
  name,
  selected,
  onSelect,
}: {
  name: string;
  selected: boolean;
  onSelect: () => void;
}) => {
  const IconComponent = resolvePositionLucideIcon(name);
  if (!IconComponent) return null;
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-md border text-gray-100",
        "hover:bg-gray-800",
        selected
          ? "border-cyan-400 bg-cyan-400/15 text-cyan-100"
          : "border-gray-700",
      )}
    >
      <IconComponent className="h-5 w-5" />
    </button>
  );
};

const PositionIconPicker = ({ label = "Icon", value, onChange }: PositionIconPickerProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const SelectedIcon = resolvePositionLucideIcon(value);

  const searchResults = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    return getAllLucideIcons()
      .filter(([name]) => name.toLowerCase().includes(trimmed))
      .slice(0, SEARCH_RESULT_LIMIT)
      .map(([name]) => name);
  }, [query]);

  const handleSelect = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery("");
  };

  return (
    <div>
      <span className="block p-1 text-sm font-semibold text-white">{label}:</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} picker`}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-left text-sm text-white",
              "hover:border-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40",
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded border border-cyan-300/30 bg-cyan-400/10 text-cyan-100">
              {SelectedIcon ? <SelectedIcon className="h-4 w-4" /> : null}
            </span>
            <span className={cn(!value && "text-gray-400")}>
              {value || "Choose an icon"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 rounded-md border border-gray-700 bg-gray-900 p-3 shadow-xl"
        >
          <div className="space-y-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Suggested
              </p>
              <div className="grid grid-cols-6 gap-1.5">
                {CURATED_ROLE_ICONS.map((name) => (
                  <IconButton
                    key={name}
                    name={name}
                    selected={value === name}
                    onSelect={() => handleSelect(name)}
                  />
                ))}
              </div>
            </div>
            <div>
              <Input
                label="Search all icons"
                hideLabel
                placeholder="Search all icons…"
                value={query}
                onChange={(next) => setQuery(String(next))}
              />
              {query.trim() ? (
                searchResults.length ? (
                  <>
                    <div className="mt-2 grid max-h-44 grid-cols-6 gap-1.5 overflow-y-auto">
                      {searchResults.map((name) => (
                        <IconButton
                          key={name}
                          name={name}
                          selected={value === name}
                          onSelect={() => handleSelect(name)}
                        />
                      ))}
                    </div>
                    {searchResults.length === SEARCH_RESULT_LIMIT ? (
                      <p className="mt-2 text-xs text-gray-500">
                        Showing first {SEARCH_RESULT_LIMIT}. Refine your search.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-gray-400">No matching icons.</p>
                )
              ) : null}
            </div>
            {value ? (
              <Button
                type="button"
                variant="textLink"
                padding="p-0"
                className="text-xs text-gray-400 hover:text-gray-200"
                onClick={() => handleSelect("")}
              >
                Clear icon
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default PositionIconPicker;
