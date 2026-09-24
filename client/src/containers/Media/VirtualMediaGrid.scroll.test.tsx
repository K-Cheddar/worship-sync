import { act, render } from "@testing-library/react";
import { VirtualMediaGrid, type VirtualMediaGridHandle } from "./VirtualMediaGrid";
import type { MediaFolder, MediaType } from "../../types";

let visibleRowIndexes: number[] = [0];
let mockScrollToIndex: jest.Mock;

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
          visibleRowIndexes = [index];
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
    mockScrollToIndex = jest.fn((index: number) => {
      visibleRowIndexes = [index];
    });
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

    expect(mockScrollToIndex).toHaveBeenCalledWith(19, { align: "auto" });
    expect(frameCallbacks).toHaveLength(1);
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
    await expect(resultPromise).resolves.toEqual({ status: "success" });
    expect(mockScrollToIndex).toHaveBeenCalledWith(1, { align: "auto" });
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
    let resultPromise!: ReturnType<VirtualMediaGridHandle["scrollToMediaId"]>;
    await act(async () => {
      resultPromise = mediaGridRef.current!.scrollToMediaId("media-1");
    });
    await flushFrame();
    await expect(resultPromise).resolves.toEqual({ status: "success" });
    expect(mockScrollToIndex).toHaveBeenLastCalledWith(0, { align: "auto" });
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
});
