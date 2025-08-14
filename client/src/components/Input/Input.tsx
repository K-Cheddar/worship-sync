import { FunctionComponent, HTMLProps, SVGProps, useId } from "react";
import cn from "classnames";
import "./Input.scss";
import Button from "../Button/Button";

export type InputProps = HTMLProps<HTMLInputElement> & {
  className?: string;
  type?: string;
  value: string | number;
  label?: string;
  hideLabel?: boolean;
  onChange: (value: string | number | Date) => void;
  labelClassName?: string;
  labelFontSize?: string;
  svg?: FunctionComponent<SVGProps<SVGSVGElement>>;
  svgAction?: () => void;
  color?: string;
  svgPadding?: string;
  svgClassName?: string;
  inputTextSize?: string;
  hideSpinButtons?: boolean;
  inputWidth?: string;
  endAdornment?: React.ReactNode;
};

const Input = ({
  className,
  type = "text",
  id,
  value,
  onChange,
  label,
  hideLabel = false,
  labelClassName,
  labelFontSize = "text-sm",
  svg,
  svgAction,
  color = "#1f2937",
  disabled = false,
  svgPadding = "p-1",
  svgClassName = "right-px",
  inputTextSize = "text-sm",
  hideSpinButtons = true,
  inputWidth = "w-full",
  endAdornment: _endAdornment,
  ...rest
}: InputProps) => {
  const generatedId = useId();
  const inputId = id || generatedId;

  let endAdornment = _endAdornment;

  if (svg) {
    endAdornment = (
      <Button
        svg={svg}
        variant="tertiary"
        className={svgClassName}
        padding={svgPadding}
        color={color}
        onClick={svgAction}
        tabIndex={-1}
        iconSize={"md"}
      />
    );
  }

  return (
    <div
      className={cn(
        className,
        "input-container",
        hideSpinButtons && "hide-spin-buttons"
      )}
    >
      <label
        htmlFor={inputId}
        className={cn(
          `${labelFontSize} font-semibold`,
          hideLabel && "sr-only",
          labelClassName
        )}
      >
        {label}:
      </label>
      <span className="relative w-full">
        <input
          className={cn(
            "rounded py-1 pl-2 text-black",
            svg ? "pr-6" : "pr-2",
            disabled && "opacity-50",
            inputTextSize,
            inputWidth
          )}
          type={type}
          value={value}
          disabled={disabled}
          data-ignore-undo="true"
          onChange={(e) => {
            const val = e.target.value;
            if (type === "number") {
              onChange(Number(val));
            } else if (type === "date") {
              onChange(new Date(val));
            } else {
              onChange(e.target.value);
            }
          }}
          id={inputId}
          {...rest}
        />
        {endAdornment && (
          <div className="absolute top-0 bottom-0 right-1 flex items-center">
            {endAdornment}
          </div>
        )}
      </span>
    </div>
  );
};

export default Input;
