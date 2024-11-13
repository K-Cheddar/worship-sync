import { FunctionComponent } from "react";
import "./Input.scss";
import Button from "../Button/Button";

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
};

const Input = ({
  className,
  type = "text",
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
  ...rest
}: InputProps) => {
  return (
    <div className={`${className} input-container`}>
      <label
        className={`${labelFontSize} font-semibold ${
          hideLabel ? "sr-only" : ""
        } ${lableClassName}`}
      >
        {label}:
      </label>
      <input
        className={`w-full rounded py-1 pl-2 text-black ${
          svg ? "pr-6" : "pr-2"
        } ${disabled ? "opacity-50" : ""}`}
        type={type}
        value={value}
        disabled={disabled}
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
        {...rest}
      />
      {svg && (
        <Button
          svg={svg}
          variant="tertiary"
          className="absolute right-0.5 bottom-0"
          padding="p-0"
          color={color}
          onClick={svgAction}
          tabIndex={-1}
        />
      )}
    </div>
  );
};

export default Input;
