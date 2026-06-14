import Input from "../../../components/Input/Input";

type EntityListSearchProps = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

const EntityListSearch = ({
  label,
  placeholder,
  value,
  onChange,
  className,
}: EntityListSearchProps) => (
  <Input
    className={className}
    label={label}
    hideLabel
    placeholder={placeholder ?? `Search ${label.toLowerCase()}…`}
    value={value}
    onChange={(next) => onChange(String(next))}
  />
);

export default EntityListSearch;
