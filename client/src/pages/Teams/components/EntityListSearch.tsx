import { X } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";

type EntityListSearchProps = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  clearable?: boolean;
};

const EntityListSearch = ({
  label,
  placeholder,
  value,
  onChange,
  className,
  clearable = false,
}: EntityListSearchProps) => (
  <Input
    className={className}
    label={label}
    hideLabel
    placeholder={placeholder ?? `Search ${label.toLowerCase()}…`}
    value={value}
    onChange={(next) => onChange(String(next))}
    endAdornment={
      clearable && value ? (
        <Button
          type="button"
          variant="tertiary"
          svg={X}
          iconSize="sm"
          padding="p-1"
          aria-label="Clear search"
          onClick={() => onChange("")}
        />
      ) : null
    }
  />
);

export default EntityListSearch;
