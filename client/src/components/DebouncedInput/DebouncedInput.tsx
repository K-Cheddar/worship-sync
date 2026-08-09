import type { FocusEventHandler } from "react";
import Input, { type InputProps } from "../Input/Input";
import useDebouncedStringCommit from "../../hooks/useDebouncedStringCommit";

export type DebouncedInputProps = Omit<InputProps, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  commitDelayMs?: number;
};

/** A controlled-looking text input whose owner is updated after typing settles. */
const DebouncedInput = ({
  value,
  onChange,
  onBlur,
  commitDelayMs,
  ...props
}: DebouncedInputProps) => {
  const draft = useDebouncedStringCommit(value, onChange, commitDelayMs);

  const handleBlur: FocusEventHandler<HTMLInputElement> = (event) => {
    draft.flush();
    onBlur?.(event);
  };

  return (
    <Input
      {...props}
      value={draft.draftValue}
      onChange={(next) => draft.setDraftValue(String(next))}
      onBlur={handleBlur}
    />
  );
};

export default DebouncedInput;
