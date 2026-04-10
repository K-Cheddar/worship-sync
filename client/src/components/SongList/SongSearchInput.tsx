import { Search, X } from "lucide-react";
import Input from "../Input/Input";

type SongSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  hideLabel?: boolean;
  label?: string;
  className?: string;
  /** When false, no trailing icon if the field is empty (matches library page). */
  showSearchIconWhenEmpty?: boolean;
};

/**
 * Search field used for song title/lyrics filtering (import drawer + shared styling).
 */
const SongSearchInput = ({
  value,
  onChange,
  disabled = false,
  placeholder,
  hideLabel = false,
  label = "Search",
  className = "shrink-0",
  showSearchIconWhenEmpty = true,
}: SongSearchInputProps) => {
  let trailingIcon: typeof X | typeof Search | undefined = undefined;
  if (value) {
    trailingIcon = X;
  } else if (showSearchIconWhenEmpty) {
    trailingIcon = Search;
  }

  const resolvedPlaceholder =
    placeholder === undefined ? "Search by title or lyrics" : placeholder;

  return (
    <Input
      label={label}
      hideLabel={hideLabel}
      className={className}
      value={value}
      disabled={disabled}
      onChange={(val) => onChange(String(val ?? ""))}
      placeholder={resolvedPlaceholder}
      svg={trailingIcon}
      svgAction={value ? () => onChange("") : undefined}
      svgActionAriaLabel={value ? "Clear search" : undefined}
      data-ignore-undo="true"
    />
  );
};

export default SongSearchInput;
