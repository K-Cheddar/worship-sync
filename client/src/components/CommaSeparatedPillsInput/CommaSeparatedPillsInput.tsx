import { type KeyboardEvent, useCallback, useId, useState } from "react";
import Label from "@/components/ui/Label";
import { cn } from "@/utils/cnHelper";

export type CommaSeparatedPillsInputProps = {
  label: string;
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
  helperText?: string;
  className?: string;
};

/**
 * Alternate names: comma commits a segment as a pill (internal spaces allowed).
 * With focus in the text area, Backspace on an empty edit removes the last pill.
 */
export function CommaSeparatedPillsInput({
  label,
  value,
  onChange,
  disabled,
  helperText,
  className,
}: CommaSeparatedPillsInputProps) {
  const id = useId();
  const inputId = `${id}-comma-pills`;
  const [draft, setDraft] = useState("");

  const commitTrailingDraft = useCallback(() => {
    const t = draft.trim();
    if (!t) {
      setDraft("");
      return;
    }
    onChange([...value, t]);
    setDraft("");
  }, [draft, onChange, value]);

  const commitCommasFromDraft = useCallback(
    (raw: string) => {
      if (!raw.includes(",")) {
        setDraft(raw);
        return;
      }
      const parts = raw.split(",");
      const complete = parts
        .slice(0, -1)
        .map((s) => s.trim())
        .filter(Boolean);
      const tail = parts[parts.length - 1] ?? "";
      if (complete.length > 0) {
        onChange([...value, ...complete]);
      }
      setDraft(tail);
    },
    [onChange, value],
  );

  const handleChange = useCallback(
    (next: string) => {
      commitCommasFromDraft(next);
    },
    [commitCommasFromDraft],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Backspace") return;
      if (draft.length > 0) return;
      if (value.length === 0) return;
      e.preventDefault();
      onChange(value.slice(0, -1));
    },
    [draft.length, onChange, value],
  );

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={inputId} className="font-semibold text-gray-300">
        {label}
      </Label>
      <div
        className={cn(
          "flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-gray-600 bg-gray-950 px-2 py-1.5 text-sm text-gray-100",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {value.map((name, index) => (
          <span
            key={name}
            className="inline-flex max-w-full rounded-full bg-gray-700 px-2 py-0.5 text-sm text-gray-100"
          >
            <span className="min-w-0 truncate">{name}</span>
          </span>
        ))}
        <input
          id={inputId}
          type="text"
          disabled={disabled}
          autoComplete="off"
          aria-label={label}
          placeholder={value.length === 0 ? "Type a name, comma for next…" : ""}
          className="min-w-32 flex-1 bg-transparent py-1 text-gray-100 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed"
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => commitTrailingDraft()}
        />
      </div>
      {helperText ? (
        <p className="text-xs text-gray-400">{helperText}</p>
      ) : null}
    </div>
  );
}
