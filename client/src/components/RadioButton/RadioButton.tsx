import { ReactComponent as CheckedSVG } from "../../assets/icons/radio-button-checked.svg";
import { ReactComponent as UncheckedSVG } from "../../assets/icons/radio-button-unchecked.svg";
import Icon from "../Icon/Icon";
import cn from "classnames";
import { useId } from "react";

type RadioButtonProps = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  className?: string;
  textSize?: string;
  labelClassName?: string;
  disabled?: boolean;
  id?: string;
};

const RadioButton = ({
  label,
  value,
  onChange,
  className = "",
  textSize = "text-sm",
  labelClassName = "",
  disabled = false,
  id: idProp,
}: RadioButtonProps) => {
  const generatedId = useId();
  const id = idProp || generatedId;

  return (
    <div
      className={cn(
        "flex gap-2 items-center relative w-fit h-fit",
        textSize,
        className,
        disabled && "opacity-50"
      )}
    >
      <label className={cn("font-semibold", labelClassName)} htmlFor={id}>
        {label}:
      </label>
      <div className=" h-4 w-4 flex items-center">
        <input
          type="radio"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className={cn(
            "w-full h-full absolute opacity-0 left-0 top-0 z-[1]",
            !disabled && "cursor-pointer"
          )}
          disabled={disabled}
          id={id}
        />
        <Icon
          svg={value ? CheckedSVG : UncheckedSVG}
          color={value ? "#67e8f9" : "#e5e7eb"}
          className={cn("absolute right-0")}
        />
      </div>
    </div>
  );
};

export default RadioButton;
