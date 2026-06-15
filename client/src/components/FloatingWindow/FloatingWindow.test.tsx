import { act, fireEvent, render, screen } from "@testing-library/react";
import FloatingWindow from "./FloatingWindow";
import { FloatingWindowZIndexProvider } from "./FloatingWindowZIndexContext";

const renderWindow = (onClose = jest.fn()) =>
  render(
    <FloatingWindowZIndexProvider>
      <FloatingWindow title="Service Planning" onClose={onClose}>
        <p>Plan content</p>
      </FloatingWindow>
    </FloatingWindowZIndexProvider>,
  );

describe("FloatingWindow", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = jest.fn();
    renderWindow(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Close window" }));

    act(() => {
      jest.advanceTimersByTime(180);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("exposes side and bottom resize handles below the title bar", () => {
    renderWindow();

    const west = screen.getByTestId("resize-handle-w");
    const east = screen.getByTestId("resize-handle-e");
    expect(west).toHaveClass("top-10", "pointer-coarse:w-12");
    expect(east).toHaveClass("top-10", "pointer-coarse:w-12");
    expect(screen.getByTestId("resize-handle-s")).toHaveClass("pointer-coarse:h-12");
    expect(screen.getByTestId("resize-handle-sw")).toHaveClass("pointer-coarse:h-12");
    expect(screen.getByTestId("resize-handle-se")).toHaveClass("pointer-coarse:h-12");
    expect(screen.queryByTestId("resize-handle-n")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resize-handle-ne")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resize-handle-nw")).not.toBeInTheDocument();
  });
});
