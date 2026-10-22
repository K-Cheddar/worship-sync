import { act, render, screen } from "@testing-library/react";
import { useResponsiveTableLayout } from "./useResponsiveTableLayout";

it("switches one layout at the content boundary and disconnects on unmount", () => {
  const originalObserver = global.ResizeObserver;
  let deliver!: ResizeObserverCallback;
  const disconnect = jest.fn();
  global.ResizeObserver = jest.fn((callback) => {
    deliver = callback;
    return { observe: jest.fn(), disconnect, unobserve: jest.fn() };
  }) as unknown as typeof ResizeObserver;
  const Fixture = () => {
    const { containerRef, compact } = useResponsiveTableLayout();
    return <section ref={containerRef}>{compact ? <span>Compact list</span> : <span>Table</span>}</section>;
  };
  try {
    const view = render(<Fixture />);
    const resize = (width: number) => act(() => deliver([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
    resize(767);
    expect(screen.getByText("Compact list")).toBeInTheDocument();
    expect(screen.queryByText("Table")).not.toBeInTheDocument();
    resize(768);
    expect(screen.getByText("Table")).toBeInTheDocument();
    resize(0);
    expect(screen.getByText("Table")).toBeInTheDocument();
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally { global.ResizeObserver = originalObserver; }
});
