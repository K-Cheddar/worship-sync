export type Meridiem = "AM" | "PM" | "";
export type Variant = "timer" | "countdown";
export type Segment = "hour" | "minute" | "second" | "meridiem";
/** `stacked`: label above the field (matches Input/Select). `inline`: label beside the field. */
export type TimePickerLabelLayout = "stacked" | "inline";

export interface BaseTimePickerProps {
  label?: string;
  /** `stacked` matches Input; default `inline` preserves existing side-by-side labels. */
  labelLayout?: TimePickerLabelLayout;
  hideLabel?: boolean;
  labelClassName?: string;
  value?: string | number;
  onChange?: (value: string | number) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  inputClassName?: string;
  dataTestInputId?: string;
  portal?: boolean;
  message?: string;
  messageType?: "error" | "warning" | "success" | "info";
  snapMinutes?: boolean;
}

export interface TimePickerProps extends BaseTimePickerProps {
  variant?: Variant;
}
