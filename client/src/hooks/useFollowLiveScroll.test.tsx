import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useRef } from "react";
import useFollowLiveScroll from "./useFollowLiveScroll";

const flushDoubleRaf = async () => {
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
};

const getHarnessItem = (container: HTMLElement, id: string) => {
  return within(container).queryByTestId(id);
};

const FollowHarness = ({
  itemId,
  renderItem = true,
  enabled = true,
  resetKey = "plan-a",
  suspensionReason,
  itemReady = true,
  itemVisible,
  scrollToItem,
}: {
  itemId: string | null;
  renderItem?: boolean;
  enabled?: boolean;
  resetKey?: string;
  suspensionReason?: string | null;
  itemReady?: boolean;
  itemVisible?: boolean;
  scrollToItem: jest.Mock;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const getItem = useCallback(getHarnessItem, []);
  const itemReadyRef = useRef(itemReady);
  itemReadyRef.current = itemReady;
  const isItemReady = useCallback(() => itemReadyRef.current, []);
  const isItemVisible = useCallback((item: HTMLElement, container: HTMLElement) => {
    const itemRect = item.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const top = containerRect.top + container.clientTop;
    const bottom = top + (container.clientHeight || containerRect.height);
    const hasGeometry = itemRect.width > 0 && itemRect.height > 0
      && containerRect.width > 0 && containerRect.height > 0;
    return itemVisible ?? (!hasGeometry || (itemRect.bottom > top && itemRect.top < bottom));
  }, [itemVisible]);
  const follow = useFollowLiveScroll({
    itemId,
    resetKey,
    enabled,
    suspensionReason,
    settleDelayMs: 40,
    containerRef,
    getItem,
    isItemReady,
    isItemVisible,
    scrollToItem,
  });

  return (
    <div
      onScrollCapture={follow.handleScroll}
      onWheel={follow.pauseLiveFollow}
      onTouchMove={follow.pauseLiveFollow}
      onPointerDown={follow.notePointerScrollIntent}
      onKeyDown={follow.handleKeyDown}
    >
      <div ref={containerRef} role="region" aria-label="Plan">
        {renderItem && itemId ? <div id={itemId} data-testid={itemId} data-live-row>Live item</div> : null}
      </div>
      {itemId && !follow.isFollowingLive ? (
        <button type="button" onClick={follow.resumeFollowing}>Follow live</button>
      ) : null}
      <div aria-label="Details panel" role="region">Details</div>
    </div>
  );
};

const setRect = (element: Element, top: number, bottom: number) => {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: top,
      width: 300,
      height: bottom - top,
      top,
      bottom,
      left: 0,
      right: 300,
      toJSON: () => ({}),
    } as DOMRect),
  });
};

const setPlanGeometry = (visible: boolean) => {
  const container = screen.getByRole("region", { name: "Plan" });
  const item = screen.getByTestId("welcome");
  setRect(container, 100, 300);
  setRect(item, visible ? 150 : 20, visible ? 180 : 70);
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 200 });
  return { container, item };
};

describe("useFollowLiveScroll", () => {
  it("follows initially and when the live item advances", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);

    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(1);

    rerender(<FollowHarness itemId="song" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(2);
    expect(scrollToItem.mock.calls[1][0]).toHaveAttribute("id", "song");
  });

  it.each([
    ["wheel", (region: HTMLElement) => fireEvent.wheel(region)],
    ["touch", (region: HTMLElement) => fireEvent.touchMove(region)],
    ["keyboard", (region: HTMLElement) => fireEvent.keyDown(region, { key: "PageDown" })],
    ["scrollbar drag", (region: HTMLElement) => {
      fireEvent.pointerDown(region);
      fireEvent.scroll(region);
    }],
  ])("pauses following after %s input", async (_name, interact) => {
    const scrollToItem = jest.fn();
    const { rerender } = render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    scrollToItem.mockClear();
    if (_name === "scrollbar drag") {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
    }

    interact(screen.getByRole("region", { name: "Plan" }));
    rerender(<FollowHarness itemId="song" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();

    expect(scrollToItem).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Follow live" })).toBeInTheDocument();
  });

  it("ignores programmatic scroll events and browser anchoring", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    fireEvent.scroll(screen.getByRole("region", { name: "Plan" }));
    expect(screen.queryByRole("button", { name: "Follow live" })).not.toBeInTheDocument();

    scrollToItem.mockClear();
    rerender(<FollowHarness itemId="song" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(1);
  });

  it("does not pause when an adjacent panel scrolls", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    scrollToItem.mockClear();

    const details = screen.getByRole("region", { name: "Details panel" });
    fireEvent.wheel(details);
    fireEvent.pointerDown(details);
    fireEvent.scroll(details);
    rerender(<FollowHarness itemId="song" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();

    expect(scrollToItem).toHaveBeenCalledTimes(1);
  });

  it("reconciles the live item when returning to an active plan tab", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();

    rerender(<FollowHarness itemId="song" suspensionReason="inactive" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(1);

    rerender(<FollowHarness itemId="song" suspensionReason={null} scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(2);
    expect(scrollToItem.mock.calls[1][0]).toHaveAttribute("id", "song");
  });

  it("preserves an explicit pause while away from the plan tab", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    fireEvent.wheel(screen.getByRole("region", { name: "Plan" }));

    rerender(<FollowHarness itemId="song" suspensionReason="inactive" scrollToItem={scrollToItem} />);
    rerender(<FollowHarness itemId="song" suspensionReason={null} scrollToItem={scrollToItem} />);
    await flushDoubleRaf();

    expect(scrollToItem).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Follow live" })).toBeInTheDocument();
  });

  it("resets its follow lifecycle when the plan identity changes", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(<FollowHarness itemId="welcome" resetKey="plan-a" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();

    rerender(<FollowHarness itemId="welcome" resetKey="plan-b" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();

    expect(scrollToItem).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Follow live" })).not.toBeInTheDocument();
  });

  it("cancels a pending follow when the plan changes with the same live item ID", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(
      <FollowHarness itemId="welcome" resetKey="plan-a" itemReady={false} scrollToItem={scrollToItem} />,
    );
    await flushDoubleRaf();
    expect(scrollToItem).not.toHaveBeenCalled();

    rerender(<FollowHarness itemId="welcome" resetKey="plan-b" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();

    expect(scrollToItem).toHaveBeenCalledTimes(1);
    expect(scrollToItem.mock.calls[0][0]).toHaveAttribute("id", "welcome");
  });

  it("cancels a pending scroll when the live item advances", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(
      <FollowHarness itemId="welcome" itemReady={false} scrollToItem={scrollToItem} />,
    );
    await flushDoubleRaf();
    expect(scrollToItem).not.toHaveBeenCalled();

    rerender(<FollowHarness itemId="song" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(1);
    expect(scrollToItem.mock.calls[0][0]).toHaveAttribute("id", "song");
  });

  it("resumes and retriggers scrolling when the live item has not changed", async () => {
    const scrollToItem = jest.fn();
    render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    fireEvent.wheel(screen.getByRole("region", { name: "Plan" }));
    scrollToItem.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Follow live" }));
    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Follow live" })).not.toBeInTheDocument();
  });

  it("waits for a delayed live row to render", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(
      <FollowHarness itemId="welcome" renderItem={false} scrollToItem={scrollToItem} />,
    );
    await flushDoubleRaf();
    expect(scrollToItem).not.toHaveBeenCalled();

    rerender(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledTimes(1));
  });

  it("does not scroll when disabled for editing, and resumes on a later live change", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(
      <FollowHarness
        itemId="welcome"
        enabled={false}
        suspensionReason="editing"
        scrollToItem={scrollToItem}
      />,
    );
    await flushDoubleRaf();
    expect(scrollToItem).not.toHaveBeenCalled();

    rerender(<FollowHarness itemId="welcome" enabled suspensionReason={null} scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    expect(scrollToItem).not.toHaveBeenCalled();

    rerender(<FollowHarness itemId="song" enabled scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(1);
  });

  it("reconciles after editing without moving the viewport and offers Follow Live when the row is away", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    const { container, item } = setPlanGeometry(false);
    const scrollTopBeforeEdit = 420;
    Object.defineProperty(container, "scrollTop", { configurable: true, writable: true, value: scrollTopBeforeEdit });
    const initialCallCount = scrollToItem.mock.calls.length;

    rerender(<FollowHarness itemId="welcome" suspensionReason="editing" scrollToItem={scrollToItem} />);
    rerender(<FollowHarness itemId="welcome" suspensionReason={null} scrollToItem={scrollToItem} />);
    await flushDoubleRaf();

    expect(scrollToItem).toHaveBeenCalledTimes(initialCallCount);
    expect(container.scrollTop).toBe(scrollTopBeforeEdit);
    expect(item.getBoundingClientRect().bottom).toBeLessThan(container.getBoundingClientRect().top);
    expect(screen.getByRole("button", { name: "Follow live" })).toBeInTheDocument();
  });

  it("keeps following after editing when the live row remains in the viewport", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    setPlanGeometry(true);
    const initialCallCount = scrollToItem.mock.calls.length;

    rerender(<FollowHarness itemId="welcome" suspensionReason="editing" scrollToItem={scrollToItem} />);
    rerender(<FollowHarness itemId="welcome" suspensionReason={null} scrollToItem={scrollToItem} />);
    await flushDoubleRaf();

    expect(scrollToItem).toHaveBeenCalledTimes(initialCallCount);
    expect(screen.queryByRole("button", { name: "Follow live" })).not.toBeInTheDocument();
  });

  it("preserves an explicit pause across edit mode and resumes on demand for the same item", async () => {
    const scrollToItem = jest.fn((item: HTMLElement) => {
      setRect(item, 150, 180);
      return true;
    });
    const { rerender } = render(<FollowHarness itemId="welcome" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    setPlanGeometry(false);
    fireEvent.wheel(screen.getByRole("region", { name: "Plan" }));
    rerender(<FollowHarness itemId="welcome" suspensionReason="editing" scrollToItem={scrollToItem} />);
    rerender(<FollowHarness itemId="welcome" suspensionReason={null} scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    expect(screen.getByRole("button", { name: "Follow live" })).toBeInTheDocument();

    const callsBeforeResume = scrollToItem.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Follow live" }));
    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(callsBeforeResume + 1);
    expect(screen.queryByRole("button", { name: "Follow live" })).not.toBeInTheDocument();

    rerender(<FollowHarness itemId="song" scrollToItem={scrollToItem} />);
    await flushDoubleRaf();
    expect(scrollToItem).toHaveBeenCalledTimes(callsBeforeResume + 2);
    expect(scrollToItem.mock.calls[callsBeforeResume + 1][0]).toHaveAttribute("id", "song");
  });

  it("waits for an expanding live row before reconciling", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(
      <FollowHarness itemId="welcome" itemReady={false} scrollToItem={scrollToItem} />,
    );
    const { container, item } = setPlanGeometry(false);
    const scrollTopBeforeEdit = 315;
    Object.defineProperty(container, "scrollTop", { configurable: true, writable: true, value: scrollTopBeforeEdit });
    rerender(
      <FollowHarness itemId="welcome" itemReady={false} suspensionReason="editing" scrollToItem={scrollToItem} />,
    );
    rerender(
      <FollowHarness itemId="welcome" itemReady={false} suspensionReason={null} scrollToItem={scrollToItem} />,
    );
    await flushDoubleRaf();
    expect(screen.queryByRole("button", { name: "Follow live" })).not.toBeInTheDocument();

    rerender(<FollowHarness itemId="welcome" itemReady scrollToItem={scrollToItem} />);
    fireEvent.transitionEnd(screen.getByRole("region", { name: "Plan" }));
    expect(await screen.findByRole("button", { name: "Follow live" })).toBeInTheDocument();
    expect(item.getBoundingClientRect().bottom).toBeLessThan(container.getBoundingClientRect().top);
    expect(container.scrollTop).toBe(scrollTopBeforeEdit);
    expect(scrollToItem).not.toHaveBeenCalled();
  });

  it("cancels pending reconciliation after a plan change", async () => {
    const scrollToItem = jest.fn();
    const { rerender } = render(
      <FollowHarness itemId="welcome" renderItem={false} scrollToItem={scrollToItem} />,
    );
    rerender(
      <FollowHarness itemId="welcome" renderItem={false} suspensionReason="editing" scrollToItem={scrollToItem} />,
    );
    rerender(
      <FollowHarness itemId="welcome" renderItem={false} suspensionReason={null} scrollToItem={scrollToItem} />,
    );
    await flushDoubleRaf();
    expect(screen.queryByRole("button", { name: "Follow live" })).not.toBeInTheDocument();

    rerender(<FollowHarness itemId="song" resetKey="plan-b" scrollToItem={scrollToItem} />);
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledTimes(1));
    expect(scrollToItem.mock.calls[0][0]).toHaveAttribute("id", "song");
    expect(screen.queryByRole("button", { name: "Follow live" })).not.toBeInTheDocument();
  });
});
