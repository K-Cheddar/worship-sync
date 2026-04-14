import {
  FunctionComponent,
  HTMLProps,
  KeyboardEvent,
  SVGProps,
  useId,
} from "react";
import { cn } from "@/utils/cnHelper";
import Button from "../Button/Button";
import UIInput from "@/components/ui/Input";
import Label from "@/components/ui/Label";

export type InputLabelLayout = "stacked" | "inline";

export type InputProps = Omit<HTMLProps<HTMLInputElement>, "onChange" | "value"> & {
  className?: string;
  type?: string;
  value: string | number;
  label?: string;
  /** `stacked`: label above the field (default). `inline`: label to the left of the field on one row. */
  labelLayout?: InputLabelLayout;
  hideLabel?: boolean;
  onChange: (value: string | number) => void;
  labelClassName?: string;
  labelFontSize?: string;
  svg?: FunctionComponent<SVGProps<SVGSVGElement>>;
  svgAction?: () => void;
  /** For icon-only trailing actions (e.g. show password, clear search) */
  svgActionAriaLabel?: string;
  color?: string;
  svgPadding?: string;
  svgClassName?: string;
  inputTextSize?: string;
  hideSpinButtons?: boolean;
  inputWidth?: string;
  inputClassName?: string;
  endAdornment?: React.ReactNode;
  /** Shown below the input field, above error text */
  helperText?: string;
  /** Classes for the helper line (default suits dark toolbars / gray cards) */
  helperTextClassName?: string;
  /** Shown below the input; pairs with aria-invalid / aria-describedby */
  errorText?: string;
  /**
   * With `type="text"`, ArrowUp/ArrowDown adjust the parsed number by this step (e.g. font-size fields).
   * Optional `min` / `max` clamp the result when set.
   */
  numericArrowStep?: number;
  /** When the value does not parse as a number, arrow keys start from this base (with `numericArrowStep`). */
  numericArrowEmptyBase?: number;
};

function stepForArrowIncrement(
  step: string | number | undefined,
): number {
  if (step == null || step === "any") return 1;
  const n = typeof step === "number" ? step : parseFloat(String(step));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseOptionalBound(
  v: string | number | undefined,
): number | undefined {
  if (v === "" || v === undefined) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

const Input = ({
  className,
  type = "text",
  id,
  value,
  onChange,
  label,
  labelLayout = "stacked",
  hideLabel = false,
  labelClassName,
  labelFontSize = "text-sm",
  svg,
  svgAction,
  svgActionAriaLabel,
  color = "#a3a3a3",
  disabled = false,
  svgPadding = "p-0.5",
  svgClassName = "right-px",
  inputTextSize = "text-sm",
  hideSpinButtons = true,
  inputWidth = "w-full",
  inputClassName,
  endAdornment: _endAdornment,
  helperText,
  helperTextClassName,
  errorText,
  numericArrowStep,
  numericArrowEmptyBase,
  min,
  max,
  step,
  onKeyDown: onKeyDownProp,
  ...rest
}: InputProps) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const helperId = useId();
  const errorId = useId();

  const {
    "aria-describedby": ariaDescribedByProp,
    ...restForInput
  } = rest;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDownProp?.(e);
    if (e.defaultPrevented) return;

    const minVal = parseOptionalBound(min);
    const maxVal = parseOptionalBound(max);

    if (type === "number" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const inc = stepForArrowIncrement(step);
      const raw =
        typeof value === "number" ? value : parseFloat(String(value));
      let current = Number.isFinite(raw) ? raw : minVal ?? 0;
      const delta = e.key === "ArrowUp" ? inc : -inc;
      let next = current + delta;
      if (minVal !== undefined) next = Math.max(minVal, next);
      if (maxVal !== undefined) next = Math.min(maxVal, next);
      onChange(Number(next));
      return;
    }

    if (
      numericArrowStep != null &&
      type === "text" &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      e.preventDefault();
      const str = String(value ?? "");
      const parsed = parseFloat(str.trim());
      const base = Number.isFinite(parsed)
        ? parsed
        : numericArrowEmptyBase ?? 0;
      const delta = e.key === "ArrowUp" ? numericArrowStep : -numericArrowStep;
      let next = base + delta;
      if (minVal !== undefined) next = Math.max(minVal, next);
      if (maxVal !== undefined) next = Math.min(maxVal, next);
      onChange(String(next));
    }
  };

  const describedByIds = [
    helperText ? helperId : null,
    errorText ? errorId : null,
    ariaDescribedByProp,
  ]
    .filter(Boolean)
    .join(" ");

  const hasTrailingAction = Boolean(svg || _endAdornment);

  let endAdornment = _endAdornment;

  const showLabel = label != null;
  const isInlineLabel = labelLayout === "inline" && showLabel;

  const labelEl = showLabel ? (
    <Label
      htmlFor={inputId}
      className={cn(
        labelFontSize,
        "font-semibold",
        isInlineLabel ? "shrink-0 py-0 pl-0 pr-0" : "p-1",
        hideLabel && "sr-only",
        labelClassName
      )}
    >
      {label}:
    </Label>
  ) : null;

  if (svg) {
    endAdornment = (
      <Button
        type="button"
        svg={svg}
        variant="tertiary"
        className={cn(
          "inline-flex h-7 w-7 min-h-0 max-md:min-h-0 shrink-0 items-center justify-center",
          svgClassName,
        )}
        padding={svgPadding}
        color={color}
        onClick={svgAction}
        tabIndex={-1}
        iconSize="sm"
        aria-label={svgActionAriaLabel}
      />
    );
  }

  const inputWrapClassName = cn(
    "relative",
    isInlineLabel ? "min-w-0 shrink-0" : "w-full"
  );

  const inputControl = (
    <span className={inputWrapClassName}>
      <UIInput
        className={cn(
          "peer py-1 pl-2 shadow-none",
          hasTrailingAction ? "pr-10" : "pr-2",
          inputTextSize,
          inputWidth,
          hideSpinButtons &&
          "appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]",
          inputClassName
        )}
        {...restForInput}
        type={type}
        value={value ?? ""}
        disabled={disabled}
        data-ignore-undo="true"
        aria-invalid={Boolean(errorText)}
        aria-describedby={describedByIds || undefined}
        onChange={(e) => {
          const val = e.target.value;
          if (type === "number") {
            onChange(Number(val));
          } else {
            onChange(val as string);
          }
        }}
        onKeyDown={handleKeyDown}
        min={min}
        max={max}
        step={step}
        id={inputId}
      />
      {endAdornment && (
        <div className="pointer-events-none absolute top-0 bottom-0 right-1.5 flex items-center">
          <span className="pointer-events-auto">{endAdornment}</span>
        </div>
      )}
    </span>
  );

  return (
    <div className={cn("group relative h-fit", className)}>
      {isInlineLabel ? (
        <div className="flex min-w-0 flex-row flex-wrap items-center gap-x-2 gap-y-1">
          {labelEl}
          {inputControl}
        </div>
      ) : (
        <>
          {labelEl}
          {inputControl}
        </>
      )}
      {helperText ? (
        <p
          id={helperId}
          className={cn(
            "mt-1 text-xs leading-relaxed text-gray-400",
            helperTextClassName
          )}
        >
          {helperText}
        </p>
      ) : null}
      {errorText ? (
        <p id={errorId} className="mt-1 text-sm text-red-400" role="alert">
          {errorText}
        </p>
      ) : null}
    </div>
  );
};

export default Input;
