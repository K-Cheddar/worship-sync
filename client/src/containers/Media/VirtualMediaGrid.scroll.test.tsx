import { act, render } from "@testing-library/react";
import { VirtualMediaGrid, type VirtualMediaGridHandle } from "./VirtualMediaGrid";
import type { MediaFolder, MediaType } from "../../types";

let visibleRowIndexes: number[] = [0];
let mockScrollToIndex: jest.Mock;
let mockScrollToOffset: jest.Mock;
let mockMountRows = true;

jest.mock("@tanstack/react-virtual", () => {
  const React = jest.requireActual("react") as typeof import("react");

  return {
    useVirtualizer: ({
      count,
      estimateSize,
    }: {
      count: number;
      estimateSize: (index: number) => number;
    }) => {
      const [, forceRender] = React.useState(0);
      const estimateSizeRef = React.useRef(estimateSize);
      estimateSizeRef.current = estimateSize;
      const indexes = visibleRowIndexes.filter((index) => index < count);
      const starts = Array.from({ length: count }, (_, index) =>
        Array.from({ length: index }, (_, previousIndex) =>
          estimateSizeRef.current(previousIndex),
        ).reduce((total, size) => total + size, 0),
      );

      const scrollToIndex = React.useCallback(
        (index: number, options: { align: "auto" }) => {
          mockScrollToIndex(index, options);
          if (mockMountRows) visibleRowIndexes = [index];
          forceRender((value) => value + 1);
        },
        [forceRender],
      );

      return React.useMemo(
        () => ({
          getTotalSize: () =>
            Array.from({ length: count }, (_, index) => index).reduce(
              (total, index) => total + estimateSizeRef.current(index),
              0,
            ),
          getVirtualItems: () =>
            indexes.map((index) => ({
              index,
              key: String(index),
              start: starts[index],
            })),
          measureElement: jest.fn(),
          measure: jest.fn(),
          scrollToIndex,
          scrollToOffset: mockScrollToOffset,
        }),
        [count, indexes, scrollToIndex, starts],
      );
    },
  };
});

jest.mock("./MediaLibraryGridMediaTile", () => ({
  __esModule: true,
  default: ({ mediaItem }: { mediaItem: MediaType }) => (
    <div>{mediaItem.name}</div>
  ),
}));

const mediaItems = Array.from({ length: 20 }, (_, index) =>
  ({
    id: `media-${index + 1}`,
    name: `Media ${index + 1}`,
    type: "image",
  }) as MediaType,
);

const grid = (
  mediaGridRef: React.RefObject<VirtualMediaGridHandle | null>,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  items: MediaType[] = mediaItems,
  options: { showFolders?: boolean; childFolders?: MediaFolder[] } = {},
) => (
  <div
    ref={scrollRef}
    data-testid="media-scroll"
    style={{ height: "100px", overflow: "auto" }}
  >
    <VirtualMediaGrid
      ref={mediaGridRef}
      scrollRef={scrollRef}
      mediaItems={items}
      cols={1}
      showFolders={options.showFolders ?? false}
      childFolders={options.childFolders ?? []}
      canGoUp={false}
      onGoUp={jest.fn()}
      onOpenFolder={jest.fn()}
      selectedMedia={{} as MediaType}
      selectedMediaIds={new Set()}
      mediaMultiSelectMode={false}
      onMediaTileClick={jest.fn()}
      onEnterMediaMultiSelectMode={jest.fn()}
      showBottomName={false}
    />
  </div>
);

describe("VirtualMediaGrid media focus scrolling", () => {
  let frameCallbacks: Array<FrameRequestCallback>;
  let requestAnimationFrameSpy: jest.SpyInstance;
  let cancelAnimationFrameSpy: jest.SpyInstance;
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeEach(() => {
    visibleRowIndexes = [0];
    mockMountRows = true;
    mockScrollToIndex = jest.fn();
    mockScrollToOffset = jest.fn();
    frameCallbacks = [];
    requestAnimationFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      });
    cancelAnimationFrameSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    getBoundingClientRectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === "media-scroll") {
          return {
            top: 0,
            bottom: 100,
            height: 100,
            left: 0,
            right: 100,
            width: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          top: 0,
          bottom: 100,
          height: 100,
          left: 0,
          right: 100,
          width: 100,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
    getBoundingClientRectSpy.mockRestore();
  });

  const flushFrame = async () => {
    await act(async () => {
      const callbacks = frameCallbacks.splice(0);
      callbacks.forEach((callback) => callback(0));
    });
  };

  it("moves a far target row before waiting for its mounted tile", async () => {
    const mediaGridRef = { current: null } as React.RefObject<VirtualMediaGridHandle | null>;
    const scrollRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    render(grid(mediaGridRef, scrollRef));

    let resultPromise!: ReturnType<VirtualMediaGridHandle["scrollToMediaId"]>;
    await act(async () => {
      resultPromise = mediaGridRef.current!.scrollToMediaId("media-20");
    });

    expect(mockScrollToIndex).toHaveBeenCalledWith(19, { align: "auto", behavior: "instant" });
    expect(frameCallbacks).toHaveLength(1);
    await flushFrame();
    await flushFrame();

    await expect(resultPromise).resolves.toEqual({ status: "success" });
  });

  it("reports a zero-height viewport as temporarily not ready, then succeeds", async () => {
    const mediaGridRef = { current: null } as React.RefObject<VirtualMediaGridHandle | null>;
    const scrollRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    const { rerender } = render(grid(mediaGridRef, scrollRef, [mediaItems[0]]));
    getBoundingClientRectSpy.mockImplementation(() =>
      ({ height: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );

    await expect(
      mediaGridRef.current!.scrollToMediaId("media-1"),
    ).resolves.toEqual({ status: "not-ready" });
    expect(mockScrollToIndex).not.toHaveBeenCalled();

    getBoundingClientRectSpy.mockImplementation(() =>
      ({ height: 100, top: 0, bottom: 100, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    rerender(grid(mediaGridRef, scrollRef, [mediaItems[0]]));

    let resultPromise!: ReturnType<VirtualMediaGridHandle["scrollToMediaId"]>;
    await act(async () => {
      resultPromise = mediaGridRef.current!.scrollToMediaId("media-1");
    });
    await flushFrame();
    await flushFrame();
    await expect(
      resultPromise,
    ).resolves.toEqual({ status: "success" });
  });

  it("includes folder rows before navigating to a target in another folder", async () => {
    const mediaGridRef = { current: null } as React.RefObject<VirtualMediaGridHandle | null>;
    const scrollRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    const folder = {
      id: "folder-1",
      name: "Backgrounds",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    } as MediaFolder;
    render(grid(mediaGridRef, scrollRef, [mediaItems[0]], {
      showFolders: true,
      childFolders: [folder],
    }));

    let resultPromise!: ReturnType<VirtualMediaGridHandle["scrollToMediaId"]>;
    await act(async () => {
      resultPromise = mediaGridRef.current!.scrollToMediaId("media-1");
    });
    await flushFrame();
    await flushFrame();
    await expect(resultPromise).resolves.toEqual({ status: "success" });
    expect(mockScrollToIndex).toHaveBeenCalledWith(1, { align: "auto", behavior: "instant" });
  });

  it("cancels an older focus attempt when a newer request takes ownership", async () => {
    const mediaGridRef = { current: null } as React.RefObject<VirtualMediaGridHandle | null>;
    const scrollRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    render(grid(mediaGridRef, scrollRef));
    const firstController = new AbortController();
    let firstResult!: ReturnType<VirtualMediaGridHandle["scrollToMediaId"]>;
    await act(async () => {
      firstResult = mediaGridRef.current!.scrollToMediaId("media-20", {
        signal: firstController.signal,
      });
    });
    firstController.abort();

    await expect(firstResult).resolves.toEqual({ status: "cancelled" });
    expect(mockScrollToOffset).toHaveBeenCalledWith(0, { behavior: "instant" });
    let resultPromise!: ReturnType<VirtualMediaGridHandle["scrollToMediaId"]>;
    await act(async () => {
      resultPromise = mediaGridRef.current!.scrollToMediaId("media-1");
    });
    await flushFrame();
    await flushFrame();
    await expect(resultPromise).resolves.toEqual({ status: "success" });
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(0, { align: "auto", behavior: "instant" });
  });

  it("reports a target that is no longer in the current rows as not found", async () => {
    const mediaGridRef = { current: null } as React.RefObject<VirtualMediaGridHandle | null>;
    const scrollRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    render(grid(mediaGridRef, scrollRef, [mediaItems[0]]));

    await expect(
      mediaGridRef.current!.scrollToMediaId("missing-media"),
    ).resolves.toEqual({ status: "not-found" });
    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });

  it("keeps retrying an unmounted far row using its current index after regrouping", async () => {
    mockMountRows = false;
    const mediaGridRef = { current: null } as React.RefObject<VirtualMediaGridHandle | null>;
    const scrollRef = { current: null } as React.RefObject<HTMLDivElement | null>;
    const { rerender } = render(grid(mediaGridRef, scrollRef));
    const settled = jest.fn();
    await act(async () => {
      void mediaGridRef.current!.scrollToMediaId("media-20").then(settled);
    });
    await flushFrame();
    await flushFrame();
    expect(settled).not.toHaveBeenCalled();
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(19, { align: "auto", behavior: "instant" });

    // A filter/layout update changes the row while the request is pending.
    rerender(grid(mediaGridRef, scrollRef, mediaItems.slice(10)));
    mockMountRows = true;
    await flushFrame();
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(9, { align: "auto", behavior: "instant" });
    await flushFrame();
    await flushFrame();
    expect(settled).toHaveBeenCalledWith({ status: "success" });
  });

  it.each(["row measurements", "panel resizing"])(
    "confirms visibility after %s move a mounted tile, scrolling only the media container",
    async (change) => {
      const mediaGridRef = { current: null } as React.RefObject<VirtualMediaGridHandle | null>;
      const scrollRef = { current: null } as React.RefObject<HTMLDivElement | null>;
      render(grid(mediaGridRef, scrollRef));
      let targetTop = 1900;
      let viewportHeight = 100;
      const rect = (top: number, height: number) => ({
        top, bottom: top + height, height, width: 100,
        left: 0, right: 100, x: 0, y: top, toJSON: () => ({}),
      }) as DOMRect;
      getBoundingClientRectSpy.mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === "media-scroll") return rect(50, viewportHeight);
        if (this.dataset.mediaId) return rect(50 + targetTop - scrollRef.current!.scrollTop, 60);
        return rect(0, 80);
      });
      const container = scrollRef.current!;
      const scrollTo = jest.fn();
      container.scrollTo = scrollTo;
      const pageScroll = jest.spyOn(window, "scrollTo");
      const settled = jest.fn();
      await act(async () => {
        void mediaGridRef.current!.scrollToMediaId("media-20").then(settled);
      });
      await flushFrame();
      // Initiating a scroll (even for a mounted tile) is not acknowledgement.
      expect(scrollTo).toHaveBeenCalledWith({ top: 1860, behavior: "instant" });
      expect(settled).not.toHaveBeenCalled();
      scrollTo.mockImplementation(({ top }: ScrollToOptions) => {
        container.scrollTop = top ?? 0;
      });
      await flushFrame(); // apply the correction
      await flushFrame(); // first visible check
      expect(settled).not.toHaveBeenCalled();

      if (change === "row measurements") targetTop += 240;
      else viewportHeight = 70;
      await flushFrame(); // layout changes invalidate the visible check
      expect(settled).not.toHaveBeenCalled();
      await flushFrame();
      await flushFrame();
      expect(settled).toHaveBeenCalledWith({ status: "success" });
      expect(pageScroll).not.toHaveBeenCalled();
      pageScroll.mockRestore();
    },
  );
});
