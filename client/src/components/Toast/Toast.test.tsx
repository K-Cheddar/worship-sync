import { act, fireEvent, render, screen } from "@testing-library/react";
import Toast from "./Toast";

describe("Toast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("does not auto-close while hovered and closes after hover ends", () => {
    const onClose = jest.fn();

    render(
      <Toast
        id="toast-1"
        message="Hover me"
        duration={1000}
        onClose={onClose}
      />
    );

    const toast = screen.getByRole("status");

    fireEvent.mouseEnter(toast);
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseLeave(toast);
    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(201);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not auto-close while focused and closes after focus leaves", () => {
    const onClose = jest.fn();

    render(
      <Toast
        id="toast-2"
        message="Focus me"
        duration={1000}
        onClose={onClose}
      />
    );

    const closeButton = screen.getByRole("button", { name: "Close toast" });
    fireEvent.focus(closeButton);
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.blur(closeButton);
    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(201);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
