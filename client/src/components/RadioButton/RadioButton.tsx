import { ReactComponent as CheckedSVG } from "../../assets/icons/radio-button-checked.svg";
import { ReactComponent as UncheckedSVG } from "../../assets/icons/radio-button-unchecked.svg";
import Icon from "../Icon/Icon";
import { useId } from "react";

type RadioButtonProps = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  className?: string;
  textSize?: string;
};

const RadioButton = ({
  label,
  value,
  onChange,
  className = "",
  textSize = "text-sm",
}: RadioButtonProps) => {
  const id = useId();

  return (
    <div
      className={`flex gap-2 items-center relative w-fit h-fit ${textSize} ${className}`}
    >
      <label htmlFor={id} className="font-semibold">
        {label}:
      </label>
      <div className="h-4 w-4 flex items-center">
        <input
          id={id}
          type="radio"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className={`w-full h-full absolute opacity-0 cursor-pointer left-0 top-0`}
        />
        <Icon
          svg={value ? CheckedSVG : UncheckedSVG}
          color={value ? "#67e8f9" : "#e5e7eb"}
          className="absolute pointer-events-none right-0"
        />
      </div>
    </div>
  );
};

export default RadioButton;
