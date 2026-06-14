import { cn } from "@/utils/cnHelper";
import Checkbox from "../../../components/Checkbox/Checkbox";

type MultiCheckboxGroupProps = {
  label: string;
  description?: string;
  options: { id: string; label: string; archived?: boolean }[];
  value: string[];
  onChange: (value: string[]) => void;
};

const MultiCheckboxGroup = ({
  label,
  description,
  options,
  value,
  onChange,
}: MultiCheckboxGroupProps) => (
  <fieldset className="min-w-0 space-y-2">
    <legend className="p-1 text-sm font-semibold">{label}</legend>
    {description ? (
      <p className="px-1 text-xs text-gray-400">{description}</p>
    ) : null}
    <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border border-gray-700 bg-gray-950/60 p-2 sm:grid-cols-2">
      {options.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing to choose yet.</p>
      ) : (
        options.map((option) => {
          const checked = value.includes(option.id);
          return (
            <Checkbox
              key={option.id}
              className={cn(
                "rounded px-2 py-1",
                option.archived && "text-gray-400",
              )}
              label={
                <span className="truncate">
                  {option.label}
                  {option.archived ? " (archived)" : ""}
                </span>
              }
              labelClassName="truncate"
              checked={checked}
              disabled={option.archived && !checked}
              onCheckedChange={() => {
                onChange(
                  checked
                    ? value.filter((id) => id !== option.id)
                    : [...value, option.id],
                );
              }}
            />
          );
        })
      )}
    </div>
  </fieldset>
);

export default MultiCheckboxGroup;
