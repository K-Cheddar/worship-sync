import { FunctionComponent } from "react";
import "./Input.scss";
import Button from "../Button/Button";
import generateRandomId from "../../utils/generateRandomId";

type InputProps = React.HTMLProps<HTMLInputElement> & {
  className?: string;
  type?: string;
  value: string | number;
  label?: string;
  hideLabel?: boolean;
  onChange: (value: string | number | Date) => void;
  lableClassName?: string;
  labelFontSize?: string;
  svg?: FunctionComponent<React.SVGProps<SVGSVGElement>>;
  svgAction?: () => void;
  iconSize?: string;
  color?: string;
  svgPadding?: string;
  svgClassName?: string;
};

const Input = ({
  className,
  type = "text",
  id,
  value,
  onChange,
  label,
  hideLabel = false,
  lableClassName,
  labelFontSize = "text-sm",
  svg,
  svgAction,
  iconSize = "md",
  color = "#1f2937",
  disabled = false,
  svgPadding = "p-1",
  svgClassName = "right-px",
  ...rest
}: InputProps) => {
  const inputId = id || generateRandomId();
  return (
    <div className={`${className || ""} input-container`}>
      <label
        htmlFor={inputId}
        className={`${labelFontSize} font-semibold ${
          hideLabel ? "sr-only" : ""
        } ${lableClassName}`}
      >
        {label}:
      </label>
      <span className="relative ">
        <input
          className={`w-full rounded py-1 pl-2 text-black ${
            svg ? "pr-6" : "pr-2"
          } ${disabled ? "opacity-50" : ""}`}
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
        {svg && (
          <Button
            svg={svg}
            variant="tertiary"
            className={`absolute bottom-0 top-0 my-auto ${svgClassName}`}
            padding={svgPadding}
            color={color}
            onClick={svgAction}
            tabIndex={-1}
          />
        )}
      </span>
    </div>
  );
};

export default Input;
