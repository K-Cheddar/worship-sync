
import { ComponentPropsWithoutRef } from "react"
import { Option } from "../../types"
import './Select.scss'
import cn from "classnames"

type SelectProps = {
  options: Option[]
  value: string
  onChange: (value: string) => void
  label: string,
  labelProps?: ComponentPropsWithoutRef<'label'>
}

const Select = ({ options, value, onChange, label, labelProps, ...rest }: SelectProps) => {
  const {className: labelClassName, ...labelRest} = labelProps || {};

  return (
    <span>
      <label className={cn('p-1 font-semibold', labelProps?.className)} {...labelRest}>{label}:</label>
      <select
        className="rounded px-2 py-1 cursor-pointer select text-black"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      >
        {options.map((option) => (
          <option className="hover:bg-green-100" key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}

export default Select;