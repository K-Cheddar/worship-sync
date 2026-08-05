import { act, fireEvent, render, screen, within } from "@testing-library/react";
import FloatingWindow from "./FloatingWindow";
import { FloatingWindowZIndexProvider } from "./FloatingWindowZIndexContext";

const renderWindow = (
  onClose = jest.fn(),
  props: React.ComponentProps<typeof FloatingWindow> = {},
) =>
  render(
    <FloatingWindowZIndexProvider>
      <FloatingWindow title="Service Planning" onClose={onClose} {...props}>
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
    expect(west).toHaveClass("top-10", "z-10", "pointer-coarse:w-3");
    expect(east).toHaveClass("top-10", "z-10", "pointer-coarse:w-3");
    expect(screen.getByTestId("resize-handle-s")).toHaveClass("z-10", "pointer-coarse:h-3");
    expect(screen.getByTestId("resize-handle-sw")).toHaveClass("z-10", "pointer-coarse:h-4");
    expect(screen.getByTestId("resize-handle-se")).toHaveClass("z-10", "pointer-coarse:h-4");
    expect(screen.queryByTestId("resize-handle-n")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resize-handle-ne")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resize-handle-nw")).not.toBeInTheDocument();
  });

  it("fires title bar actions from a touch tap without needing a second press", () => {
    const onClose = jest.fn();
    renderWindow(onClose);

    const closeButton = screen.getByRole("button", { name: "Close window" });
    fireEvent.touchStart(closeButton, {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    fireEvent.click(closeButton);

    act(() => {
      jest.advanceTimersByTime(180);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires content button clicks after a touchstart that bubbles to the window", () => {
    const onContentClick = jest.fn();
    render(
      <FloatingWindowZIndexProvider>
        <FloatingWindow title="Service Planning" onClose={jest.fn()}>
          <button type="button" onClick={onContentClick}>
            Sync All
          </button>
        </FloatingWindow>
      </FloatingWindowZIndexProvider>,
    );

    const contentButton = screen.getByRole("button", { name: "Sync All" });
    const windowEl = screen.getByTestId("floating-window");

    // Same path as a real touch: target receives touchstart, then it bubbles to
    // the window raise handler, then the synthesized click fires.
    fireEvent.touchStart(contentButton, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    fireEvent.touchStart(windowEl, {
      touches: [{ clientX: 40, clientY: 80 }],
    });
    fireEvent.click(contentButton);

    expect(onContentClick).toHaveBeenCalledTimes(1);
  });

  it("updates fixed dimensions when the southeast handle is dragged", () => {
    renderWindow(jest.fn(), { defaultWidth: 400, defaultHeight: 300 });

    const windowEl = screen.getByTestId("floating-window");
    expect(windowEl).toHaveStyle({ width: "400px", height: "300px" });

    fireEvent.mouseDown(screen.getByTestId("resize-handle-se"), {
      clientX: 400,
      clientY: 300,
    });
    fireEvent.mouseMove(document, { clientX: 460, clientY: 360 });
    fireEvent.mouseUp(document);

    expect(windowEl).toHaveStyle({ width: "460px", height: "360px" });
  });

  it("clears autoHeight maxHeight after the first resize", () => {
    renderWindow(jest.fn(), { autoHeight: true, defaultHeight: 300 });

    const windowEl = screen.getByTestId("floating-window");
    expect(windowEl).toHaveStyle({ maxHeight: "min(300px, 100vh)" });

    fireEvent.mouseDown(screen.getByTestId("resize-handle-e"), {
      clientX: 400,
      clientY: 200,
    });
    fireEvent.mouseMove(document, { clientX: 460, clientY: 200 });
    fireEvent.mouseUp(document);

    // Content-specific max is cleared; viewport cap remains.
    expect(windowEl).toHaveStyle({ maxHeight: "100vh", maxWidth: "100vw" });
  });

  it("clamps default size to the viewport", () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    renderWindow(jest.fn(), {
      defaultWidth: vw + 400,
      defaultHeight: vh + 400,
    });

    const windowEl = screen.getByTestId("floating-window");
    expect(windowEl).toHaveStyle({
      width: `${vw}px`,
      height: `${vh}px`,
      maxWidth: "100vw",
      maxHeight: "100vh",
    });
  });

  it("shrinks to fit when the viewport gets smaller", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;

    renderWindow(jest.fn(), { defaultWidth: 400, defaultHeight: 300 });

    const windowEl = screen.getByTestId("floating-window");
    expect(windowEl).toHaveStyle({ width: "400px", height: "300px" });

    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 240 });
      window.dispatchEvent(new Event("resize"));
    });

    expect(windowEl).toHaveStyle({ width: "320px", height: "240px" });

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalHeight,
    });
  });

  it("opens a new window above an existing one", () => {
    render(
      <FloatingWindowZIndexProvider>
        <FloatingWindow title="First" onClose={jest.fn()}>
          <p>One</p>
        </FloatingWindow>
        <FloatingWindow title="Second" onClose={jest.fn()}>
          <p>Two</p>
        </FloatingWindow>
      </FloatingWindowZIndexProvider>,
    );

    const [first, second] = screen.getAllByTestId("floating-window");
    const firstZ = Number(first.style.zIndex);
    const secondZ = Number(second.style.zIndex);
    expect(secondZ).toBeGreaterThan(firstZ);
  });

  it("shows a dock to switch between open windows", () => {
    render(
      <FloatingWindowZIndexProvider>
        <FloatingWindow title="First" onClose={jest.fn()}>
          <p>One</p>
        </FloatingWindow>
        <FloatingWindow title="Second" onClose={jest.fn()}>
          <p>Two</p>
        </FloatingWindow>
      </FloatingWindowZIndexProvider>,
    );

    const dock = screen.getByTestId("floating-window-dock");
    expect(within(dock).getByRole("button", { name: "First" })).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "Second" })).toBeInTheDocument();

    const [first, second] = screen.getAllByTestId("floating-window");
    fireEvent.click(within(dock).getByRole("button", { name: "First" }));

    expect(Number(first.style.zIndex)).toBeGreaterThan(Number(second.style.zIndex));
    expect(within(dock).getByRole("button", { name: "First" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("hides the dock when only one window is open", () => {
    renderWindow();
    expect(screen.queryByTestId("floating-window-dock")).not.toBeInTheDocument();
  });
});
