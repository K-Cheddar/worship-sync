export type Meridiem = "AM" | "PM" | "";
export type Variant = "timer" | "countdown";
export type Segment = "hour" | "minute" | "second" | "meridiem";

export interface BaseTimePickerProps {
  label?: string;
  value?: string | number;
  onChange?: (value: string | number) => void;
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
