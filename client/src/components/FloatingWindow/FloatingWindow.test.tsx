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

    const west = document.querySelector("[data-resize-dir='w']");
    const east = document.querySelector("[data-resize-dir='e']");
    expect(west).toHaveClass("top-10", "pointer-coarse:w-12");
    expect(east).toHaveClass("top-10", "pointer-coarse:w-12");
    expect(document.querySelector("[data-resize-dir='s']")).toHaveClass("pointer-coarse:h-12");
    expect(document.querySelector("[data-resize-dir='sw']")).toHaveClass("pointer-coarse:h-12");
    expect(document.querySelector("[data-resize-dir='se']")).toHaveClass("pointer-coarse:h-12");
    expect(document.querySelector("[data-resize-dir='n']")).toBeNull();
    expect(document.querySelector("[data-resize-dir='ne']")).toBeNull();
    expect(document.querySelector("[data-resize-dir='nw']")).toBeNull();
  });
});
