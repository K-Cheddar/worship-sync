import { useEffect, useState } from "react";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import type { BirthDate } from "../../../api/authTypes";

type BirthDateFieldProps = {
  value?: BirthDate | null;
  onChange: (value: BirthDate | null) => void;
  label?: string;
  labelClassName?: string;
  inputClassName?: string;
  className?: string;
};

const monthOptions = [
  { value: "", label: "Month" },
  ...Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1),
    label: new Date(2000, index, 1).toLocaleDateString(undefined, { month: "long" }),
  })),
];
const birthdayControlClassName =
  "h-9 min-h-9 w-full px-3 py-1 text-left text-sm shadow-none";
const BirthDateField = ({
  value,
  onChange,
  label = "Birthday",
  labelClassName,
  inputClassName,
  className,
}: BirthDateFieldProps) => {
  const [draft, setDraft] = useState<BirthDate>(() => ({ ...(value || {}) } as BirthDate));

  useEffect(() => {
    setDraft({ ...(value || {}) } as BirthDate);
  }, [value]);

  const update = (part: "month" | "day" | "year", raw: string) => {
    const next = { ...draft, [part]: raw ? Number(raw) : undefined } as BirthDate;
    setDraft(next);
    if (!next.month || !next.day) {
      if (value) onChange(null);
      return;
    }
    onChange(next);
  };

  return (
    <div className={className || "sm:col-span-6"}>
      <span className={`block p-1 text-sm font-semibold ${labelClassName || ""}`}>{label}</span>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Select
            label="Month"
            hideLabel
            options={monthOptions}
            value={draft.month ? String(draft.month) : ""}
            onChange={(month) => update("month", month)}
            selectClassName={`${inputClassName || ""} ${birthdayControlClassName}`}
          />
        </div>
        <div>
          <Input
            label="Day"
            hideLabel
            type="number"
            min={1}
            max={31}
            placeholder="Day"
            value={draft.day ? String(draft.day) : ""}
            onChange={(day) => update("day", String(day))}
            inputClassName={`${inputClassName || ""} ${birthdayControlClassName}`}
          />
        </div>
        <div>
          <Input
            label="Year (optional)"
            hideLabel
            placeholder="Year"
            type="number"
            min={1}
            max={new Date().getFullYear()}
            value={draft.year ? String(draft.year) : ""}
            onChange={(year) => update("year", String(year))}
            inputClassName={`${inputClassName || ""} ${birthdayControlClassName}`}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-400">Month and day are required. Year is optional.</p>
    </div>
  );
};

export default BirthDateField;
