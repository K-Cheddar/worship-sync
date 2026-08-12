import { act, fireEvent, render, screen } from "@testing-library/react";
import Toast from "./Toast";

describe("Toast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("shows a dismiss progress bar when the toast has a duration", () => {
    render(
      <Toast
        id="toast-progress"
        message="Timed toast"
        duration={1000}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId("toast-progress")).toBeInTheDocument();
  });

  it("allows content to wrap within a mobile-friendly max width", () => {
    render(
      <Toast
        id="toast-wrap"
        message="Earlier-day comments are still in the board and Restream chat. Start fresh for today?"
        onClose={jest.fn()}
      />
    );

    const toast = screen.getByRole("status");
    expect(toast).toHaveClass("max-w-[75vw]");
    expect(toast).not.toHaveClass("max-w-[50vw]");
    expect(screen.getByText(/Earlier-day comments/)).toHaveClass(
      "wrap-break-word"
    );
  });

  it("does not show a progress bar for persistent toasts", () => {
    render(
      <Toast
        id="toast-persist"
        message="Stay open"
        persist
        onClose={jest.fn()}
      />
    );

    expect(screen.queryByTestId("toast-progress")).not.toBeInTheDocument();
  });

  it("uses the chat treatment for incoming team messages", () => {
    render(
      <Toast
        id="toast-chat"
        message="New team message"
        variant="chat"
        position="top-right"
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveStyle({
      borderColor: "#22d3ee",
    });
  });

  it("pauses the progress bar while hovered", () => {
    render(
      <Toast
        id="toast-pause-progress"
        message="Hover me"
        duration={1000}
        onClose={jest.fn()}
      />
    );

    const toast = screen.getByRole("status");
    const progress = screen.getByTestId("toast-progress");

    expect(progress).toHaveStyle({ animationPlayState: "running" });

    fireEvent.mouseEnter(toast);
    expect(progress).toHaveStyle({ animationPlayState: "paused" });

    fireEvent.mouseLeave(toast);
    expect(progress).toHaveStyle({ animationPlayState: "running" });
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

describe("Toast variants", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("renders the warning variant for a partial success", () => {
    render(
      <Toast
        id="toast-warning"
        message="Sent to 4 people. 1 person has no email on file."
        variant="warning"
        onClose={jest.fn()}
      />,
    );

    expect(
      screen.getByText(/1 person has no email on file/),
    ).toBeInTheDocument();
  });

  // An unrecognised variant used to read `config.textColor` off undefined and
  // take the whole page down. A styling choice must never be able to do that.
  it("falls back instead of crashing on an unknown variant", () => {
    render(
      <Toast
        id="toast-unknown"
        message="Still readable"
        variant={"nonsense" as never}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText("Still readable")).toBeInTheDocument();
  });
});
