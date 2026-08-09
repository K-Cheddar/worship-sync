import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimePickerCountdown } from "./TimePickerCountdown";

const blurAndFlush = async (input: HTMLElement) => {
  fireEvent.blur(input);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const selectRange = (input: HTMLInputElement, start: number, end: number) => {
  input.setSelectionRange(start, end);
};

describe("TimePickerCountdown blur completion", () => {
  it("commits 00 AM when blurring with only an hour typed", async () => {
    const onChange = jest.fn();
    render(
      <TimePickerCountdown
        label="Start time"
        value=""
        onChange={onChange}
        dataTestInputId="time-input"
        portal={false}
      />,
    );

    const input = screen.getByTestId("time-input") as HTMLInputElement;
    input.focus();
    fireEvent.focus(input);
    selectRange(input, 0, 2);
    fireEvent.keyDown(input, { key: "9" });
    expect(input).toHaveValue("09:00 aa");
    onChange.mockClear();

    await blurAndFlush(input);

    expect(onChange).toHaveBeenCalledWith("09:00");
    expect(input).toHaveValue("09:00 AM");
  });

  it("commits AM when blurring with hour and minute but no meridiem", async () => {
    const onChange = jest.fn();
    render(
      <TimePickerCountdown
        label="Start time"
        value=""
        onChange={onChange}
        dataTestInputId="time-input"
        portal={false}
      />,
    );

    const input = screen.getByTestId("time-input") as HTMLInputElement;
    input.focus();
    fireEvent.focus(input);
    selectRange(input, 0, 2);
    fireEvent.keyDown(input, { key: "9" });
    selectRange(input, 3, 5);
    fireEvent.keyDown(input, { key: "3" });
    selectRange(input, 3, 5);
    fireEvent.keyDown(input, { key: "0" });
    expect(input).toHaveValue("09:30 aa");
    onChange.mockClear();

    await blurAndFlush(input);

    expect(onChange).toHaveBeenCalledWith("09:30");
    expect(input).toHaveValue("09:30 AM");
  });

  it("does not invent a time when blurring an empty field", async () => {
    const onChange = jest.fn();
    render(
      <TimePickerCountdown
        label="Start time"
        value=""
        onChange={onChange}
        dataTestInputId="time-input"
        portal={false}
      />,
    );

    const input = screen.getByTestId("time-input");
    input.focus();
    fireEvent.focus(input);
    onChange.mockClear();

    await blurAndFlush(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("hh:mm aa");
  });

  it("commits defaults when closing the popover after selecting only an hour", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <TimePickerCountdown
        label="Start time"
        value=""
        onChange={onChange}
        dataTestInputId="time-input"
        portal={false}
      />,
    );

    await user.click(screen.getByTestId("time-input"));
    await user.click(screen.getByRole("option", { name: "9" }));
    onChange.mockClear();

    await user.keyboard("{Escape}");

    expect(onChange).toHaveBeenCalledWith("09:00");
    expect(screen.getByTestId("time-input")).toHaveValue("09:00 AM");
  });

  it("commits AM when closing after selecting hour and minute", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <TimePickerCountdown
        label="Start time"
        value=""
        onChange={onChange}
        dataTestInputId="time-input"
        portal={false}
      />,
    );

    await user.click(screen.getByTestId("time-input"));
    await user.click(screen.getByRole("option", { name: "9" }));
    await user.click(screen.getByRole("option", { name: "30" }));
    onChange.mockClear();

    await user.keyboard("{Escape}");

    expect(onChange).toHaveBeenCalledWith("09:30");
    expect(screen.getByTestId("time-input")).toHaveValue("09:30 AM");
  });
});
