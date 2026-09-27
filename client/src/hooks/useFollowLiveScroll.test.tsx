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
  scrollToItem,
}: {
  itemId: string | null;
  renderItem?: boolean;
  enabled?: boolean;
  resetKey?: string;
  suspensionReason?: string | null;
  itemReady?: boolean;
  scrollToItem: jest.Mock;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const getItem = useCallback(getHarnessItem, []);
  const isItemReady = useCallback(() => itemReady, [itemReady]);
  const follow = useFollowLiveScroll({
    itemId,
    resetKey,
    enabled,
    suspensionReason,
    settleDelayMs: 40,
    containerRef,
    getItem,
    isItemReady,
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
        {renderItem && itemId ? <div id={itemId} data-testid={itemId}>Live item</div> : null}
      </div>
      {itemId && !follow.isFollowingLive ? (
        <button type="button" onClick={follow.resumeFollowing}>Follow live</button>
      ) : null}
      <div aria-label="Details panel" role="region">Details</div>
    </div>
  );
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
});
