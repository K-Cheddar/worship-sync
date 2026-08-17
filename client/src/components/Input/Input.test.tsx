import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Input, { coerceNumberInputOnBlur } from "./Input";

describe("coerceNumberInputOnBlur", () => {
  it("uses 0 for empty or invalid values", () => {
    expect(coerceNumberInputOnBlur("")).toBe(0);
    expect(coerceNumberInputOnBlur("   ")).toBe(0);
    expect(coerceNumberInputOnBlur("abc")).toBe(0);
  });

  it("clamps to min and max when provided", () => {
    expect(coerceNumberInputOnBlur("", 1)).toBe(1);
    expect(coerceNumberInputOnBlur("0", 1, 10)).toBe(1);
    expect(coerceNumberInputOnBlur("99", 1, 10)).toBe(10);
    expect(coerceNumberInputOnBlur("4", 1, 10)).toBe(4);
  });
});

const NumberField = ({
  initial = 3,
  min,
  max,
}: {
  initial?: number;
  min?: number;
  max?: number;
}) => {
  const [value, setValue] = useState<string | number>(initial);
  return (
    <Input
      label="Required"
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={setValue}
    />
  );
};

describe("Input type=number", () => {
  it("allows clearing while typing, then coerces empty to 0 on blur", async () => {
    const user = userEvent.setup();
    render(<NumberField initial={5} />);

    const input = screen.getByLabelText("Required:");
    expect(input).toHaveValue(5);

    await user.clear(input);
    expect(input).toHaveValue(null);

    await user.tab();
    expect(input).toHaveValue(0);
  });

  it("coerces empty to min on blur when min is set", async () => {
    const user = userEvent.setup();
    render(<NumberField initial={5} min={1} />);

    const input = screen.getByLabelText("Required:");
    await user.clear(input);
    expect(input).toHaveValue(null);

    await user.tab();
    expect(input).toHaveValue(1);
  });

  it("lets the user replace the value after clearing", async () => {
    const user = userEvent.setup();
    render(<NumberField initial={5} min={1} />);

    const input = screen.getByLabelText("Required:");
    await user.clear(input);
    await user.type(input, "12");
    expect(input).toHaveValue(12);

    await user.tab();
    expect(input).toHaveValue(12);
  });
});
