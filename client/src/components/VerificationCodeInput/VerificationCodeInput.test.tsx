import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import VerificationCodeInput from "./VerificationCodeInput";

const Harness = () => {
  const [code, setCode] = useState("");
  return (
    <>
      <VerificationCodeInput value={code} onChange={setCode} />
      <span data-testid="code-value">{code}</span>
    </>
  );
};

describe("VerificationCodeInput", () => {
  it("fills all slots when the first field receives a full 6-digit string (e.g. mobile OTP suggestion)", () => {
    render(<Harness />);

    const first = screen.getByLabelText("Digit 1 of 6");
    fireEvent.change(first, { target: { value: "482913" } });

    expect(screen.getByTestId("code-value")).toHaveTextContent("482913");
    expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("4");
    expect(screen.getByLabelText("Digit 2 of 6")).toHaveValue("8");
    expect(screen.getByLabelText("Digit 3 of 6")).toHaveValue("2");
    expect(screen.getByLabelText("Digit 4 of 6")).toHaveValue("9");
    expect(screen.getByLabelText("Digit 5 of 6")).toHaveValue("1");
    expect(screen.getByLabelText("Digit 6 of 6")).toHaveValue("3");
  });

  it("strips non-digits and caps at six when pasting into the first field via change", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Digit 1 of 6"), {
      target: { value: "12-34-56-78" },
    });

    expect(screen.getByTestId("code-value")).toHaveTextContent("123456");
  });
});
