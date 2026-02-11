import { useCallback, useEffect, useRef, useState } from "react";
import TextArea from "../TextArea/TextArea";
import Input from "../Input/Input";
import Button from "../Button/Button";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/Popover";
import { X } from "lucide-react";
import { cn } from "../../utils/cnHelper";

const HISTORY_SORT = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });
const MAX_SUGGESTIONS = 10;

function sortAndSlice(items: string[], max = MAX_SUGGESTIONS): string[] {
  return [...items].sort(HISTORY_SORT).slice(0, max);
}

function getCaretLineInfo(value: string, caret: number) {
  const allLines = value.split("\n");
  const beforeCaret = value.slice(0, caret);
  const lineIndex = beforeCaret.split("\n").length - 1;
  return { allLines, lineIndex };
}

export type HistorySuggestFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** History values used for suggestions (e.g. past names, headings). */
  historyValues: string[];
  /** Optional callback to remove a value from the underlying history store. */
  onRemoveHistoryValue?: (value: string) => void;
  /** If true, use TextArea with line-scoped suggestions; if false, use Input with whole-value suggestions. */
  multiline?: boolean;
  /** Label for the field (passed to Input/TextArea). */
  label?: string;
  /** Placeholder (passed to Input/TextArea). */
  placeholder?: string;
  hideLabel?: boolean;
  className?: string;
  labelClassName?: string;
  disabled?: boolean;
  /** Only for multiline: enable auto-resize on TextArea. */
  autoResize?: boolean;
  "data-ignore-undo"?: string;
};

const HistorySuggestField = ({
  value,
  onChange,
  historyValues,
  onRemoveHistoryValue,
  multiline = true,
  label = "Text",
  placeholder = "Text",
  hideLabel,
  className,
  labelClassName,
  disabled = false,
  autoResize = true,
  "data-ignore-undo": dataIgnoreUndo,
}: HistorySuggestFieldProps) => {
  const effectiveHideLabel = hideLabel ?? (multiline ? true : false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const allowCloseRef = useRef(false);

  const showDropdown = suggestions.length > 0 && isFocused;

  useEffect(() => {
    if (!showDropdown) {
      allowCloseRef.current = false;
      return;
    }
    allowCloseRef.current = false;
    const id = setTimeout(() => {
      allowCloseRef.current = true;
    }, 150);
    return () => clearTimeout(id);
  }, [showDropdown]);

  const updateSuggestions = useCallback(
    (nextValue: string) => {
      if (!historyValues?.length) {
        setSuggestions([]);
        setActiveSuggestionIndex(null);
        return;
      }

      if (multiline) {
        const caret =
          textAreaRef.current?.selectionStart ?? nextValue.length;
        const { allLines, lineIndex } = getCaretLineInfo(nextValue, caret);
        const currentLine = (allLines[lineIndex] ?? "").trim().toLowerCase();
        const existingTrimmed = new Set(allLines.map((l) => l.trim()).filter(Boolean));
        const base = historyValues.filter((line) => {
          const t = line.trim();
          return t && !existingTrimmed.has(t);
        });
        const filtered = sortAndSlice(
          base.filter((line) => line.toLowerCase().includes(currentLine))
        );
        setSuggestions(filtered);
      } else {
        const current = nextValue.trim().toLowerCase();
        if (current.length === 0) {
          const trimmed = historyValues.map((v) => v.trim()).filter(Boolean);
          setSuggestions(sortAndSlice(trimmed));
          setActiveSuggestionIndex(null);
          return;
        }
        const filtered = sortAndSlice(
          historyValues.filter(
            (v) =>
              v.trim() &&
              v.trim().toLowerCase().includes(current) &&
              v.trim().toLowerCase() !== current
          )
        );
        setSuggestions(filtered);
      }
      setActiveSuggestionIndex(null);
    },
    [historyValues, multiline]
  );

  const applySuggestion = useCallback(
    (suggestion: string) => {
      if (multiline) {
        const currentValue = textAreaRef.current?.value ?? value;
        const caret = textAreaRef.current?.selectionStart ?? currentValue.length;
        const { allLines, lineIndex } = getCaretLineInfo(currentValue, caret);
        const newLines = [...allLines];
        newLines[lineIndex] = suggestion;
        onChange(newLines.join("\n"));
      } else {
        onChange(suggestion);
      }
      setSuggestions([]);
      setActiveSuggestionIndex(null);
    },
    [multiline, onChange, value]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!suggestions.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestionIndex((prev) =>
          prev == null ? 0 : Math.min(prev + 1, suggestions.length - 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestionIndex((prev) =>
          prev == null ? suggestions.length - 1 : Math.max(prev - 1, 0)
        );
      } else if (e.key === "Enter") {
        if (activeSuggestionIndex != null) {
          e.preventDefault();
          applySuggestion(suggestions[activeSuggestionIndex]);
        }
      } else if (e.key === "Escape") {
        setSuggestions([]);
        setActiveSuggestionIndex(null);
      }
    },
    [suggestions, activeSuggestionIndex, applySuggestion]
  );

  const handleChange = useCallback(
    (str: string) => {
      onChange(str);
      updateSuggestions(str);
    },
    [onChange, updateSuggestions]
  );

  const commonFieldProps = {
    value,
    label,
    hideLabel: effectiveHideLabel,
    placeholder,
    className: className ?? "flex flex-col gap-1",
    labelClassName,
    disabled,
    "data-ignore-undo": dataIgnoreUndo,
  };

  const textAreaOnChange = useCallback(
    (eOrVal: React.FormEvent<HTMLTextAreaElement> | string) => {
      const str =
        typeof eOrVal === "string"
          ? eOrVal
          : (eOrVal.target as HTMLTextAreaElement).value;
      handleChange(str);
    },
    [handleChange]
  );

  const inputOnChange = useCallback(
    (eOrVal: React.FormEvent<HTMLInputElement> | string | number) => {
      const str =
        typeof eOrVal === "object" && eOrVal !== null && "target" in eOrVal
          ? String((eOrVal.target as HTMLInputElement).value)
          : String(eOrVal);
      handleChange(str);
    },
    [handleChange]
  );

  return (
    <Popover
      open={showDropdown}
      onOpenChange={(open) => {
        if (!open && allowCloseRef.current) setIsFocused(false);
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative flex flex-col gap-1">
          {multiline ? (
            <TextArea
              ref={textAreaRef}
              {...commonFieldProps}
              onChange={
                textAreaOnChange as React.FormEventHandler<HTMLTextAreaElement> &
                ((value: string) => void)
              }
              autoResize={autoResize}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setIsFocused(true);
                updateSuggestions(value);
              }}
              onBlur={() => setIsFocused(false)}
              onClick={() => updateSuggestions(value)}
              onSelect={() => updateSuggestions(value)}
            />
          ) : (
            <Input
              ref={inputRef}
              {...commonFieldProps}
              onChange={
                inputOnChange as React.FormEventHandler<HTMLInputElement> &
                ((value: string | number) => void)
              }
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setIsFocused(true);
                updateSuggestions(value);
              }}
              onBlur={() => setIsFocused(false)}
              onClick={() => updateSuggestions(value)}
              onSelect={() => updateSuggestions(value)}
            />
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="max-h-40 overflow-y-auto rounded border border-gray-600 bg-gray-900 p-0 py-1 shadow-lg text-left text-xs w-(--radix-popover-trigger-width)"
        data-history-suggest-content
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ul role="listbox" aria-label="Suggestions">
          {suggestions.map((s, index) => (
            <li
              key={`${s}-${index}`}
              role="option"
              aria-selected={index === activeSuggestionIndex}
              className={cn(
                "px-2 py-1 cursor-pointer hover:bg-gray-700",
                index === activeSuggestionIndex && "bg-gray-700"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(s);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-white">{s}</span>
                {onRemoveHistoryValue && (
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={X}
                    className="text-xs text-red-400 hover:text-red-200 min-w-0"
                    padding="p-0"
                    aria-label={`Remove "${s}" from history`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRemoveHistoryValue(s);
                      const removedIndex = suggestions.indexOf(s);
                      setSuggestions((prev) => prev.filter((x) => x !== s));
                      setActiveSuggestionIndex((prev) => {
                        if (prev == null) return null;
                        if (removedIndex === prev) return null;
                        return removedIndex < prev ? prev - 1 : prev;
                      });
                    }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

export default HistorySuggestField;
