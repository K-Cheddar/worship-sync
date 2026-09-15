import { render, screen } from "@testing-library/react";
import MediaLibraryGrid from "./MediaLibraryGrid";
import type { MediaType } from "../../types";
import type { VirtualMediaGridHandle } from "./VirtualMediaGrid";

let mockViewportHeight = 600;
let mockScrollHeight = 1000;
const mockVirtualizerSnapshots: Array<{
  count: number;
  viewportHeight: number;
  scrollHeight: number;
  virtualItemCount: number;
  totalSize: number;
  starts: number[];
}> = [];

jest.mock("@tanstack/react-virtual", () => {
  const React = jest.requireActual("react") as typeof import("react");
  type TestInstance = { scrollElement: HTMLElement | null };
  type RectCallback = (rect: { width: number; height: number }) => void;
  type ObserveElementRect = (
    instance: TestInstance,
    callback: RectCallback,
  ) => (() => void) | undefined;

  const observeElementRect: ObserveElementRect = (instance, callback) => {
    callback({
      width: instance.scrollElement?.clientWidth ?? 0,
      height: instance.scrollElement?.clientHeight ?? 0,
    });
    return jest.fn();
  };

  return {
    observeElementRect,
    useVirtualizer: (options: {
      count: number;
      getScrollElement: () => HTMLElement | null;
      initialRect?: { width: number; height: number };
      observeElementRect?: ObserveElementRect;
    }) => {
      const [, forceRender] = React.useState(0);
      const viewportHeightRef = React.useRef(0);
      const scrollElementRef = React.useRef<HTMLElement | null>(null);
      const fallbackElementRef = React.useRef<HTMLElement | null>(null);
      const getScrollElement = options.getScrollElement;

      React.useLayoutEffect(() => {
        if (!fallbackElementRef.current) {
          fallbackElementRef.current = {
            get clientWidth() {
              return 800;
            },
            get clientHeight() {
              return mockViewportHeight;
            },
          } as unknown as HTMLElement;
        }
        scrollElementRef.current =
          getScrollElement() ?? fallbackElementRef.current;
        const cleanup = (options.observeElementRect ?? observeElementRect)(
          { scrollElement: scrollElementRef.current },
          (rect) => {
            if (viewportHeightRef.current !== rect.height) {
              viewportHeightRef.current = rect.height;
              forceRender((value) => value + 1);
            }
          },
        );
        return cleanup;
      }, [forceRender, getScrollElement, options.observeElementRect]);

      React.useEffect(() => {
        return () => {
          scrollElementRef.current = null;
          fallbackElementRef.current = null;
        };
      }, []);

      return {
        getTotalSize: () => options.count * 100,
        getVirtualItems: () => {
          const virtualItemCount = viewportHeightRef.current > 0 ? options.count : 0;
          const starts = Array.from(
            { length: virtualItemCount },
            (_, index) => index * 100,
          );
          mockVirtualizerSnapshots.push({
            count: options.count,
            viewportHeight: viewportHeightRef.current,
            scrollHeight: mockScrollHeight,
            virtualItemCount,
            totalSize: options.count * 100,
            starts,
          });
          return starts.map((start, index) => ({
            index,
            key: String(index),
            start,
          }));
        },
        measure: jest.fn(),
        measureElement: jest.fn(),
        scrollToIndex: jest.fn(),
      };
    },
  };
});

jest.mock("./MediaLibraryGridMediaTile", () => ({
  __esModule: true,
  default: ({ mediaItem }: { mediaItem: MediaType }) => (
    <div data-testid="media-grid-tile">{mediaItem.name}</div>
  ),
}));

const mediaItems = Array.from({ length: 20 }, (_, index) =>
  ({
    id: `media-${index + 1}`,
    name: `Media ${index + 1}`,
    type: "image",
  }) as MediaType,
);

const renderGrid = (
  isMediaExpanded: boolean,
  mediaListRef: React.RefObject<HTMLElement | null>,
  mediaGridRef: React.RefObject<VirtualMediaGridHandle | null>,
) => (
  <MediaLibraryGrid
    isPanelVariant
    isMediaExpanded={isMediaExpanded}
    isMediaLoading={false}
    hasMediaLoadError={false}
    mediaItemsPerRow={2}
    mediaListRef={mediaListRef}
    mediaGridRef={mediaGridRef}
    filteredList={mediaItems}
    showAll
    showNamesInPanelGrid={false}
    searchTerm=""
    childFolders={[]}
    canGoUp={false}
    onGoUp={jest.fn()}
    onOpenFolder={jest.fn()}
    selectedMedia={mediaItems[0]}
    selectedMediaIds={new Set()}
    mediaMultiSelectMode={false}
    onMediaTileClick={jest.fn()}
    onEnterMediaMultiSelectMode={jest.fn()}
  />
);

describe("MediaLibraryGrid viewport lifecycle", () => {
  let clientHeightDescriptor: PropertyDescriptor | undefined;
  let scrollHeightDescriptor: PropertyDescriptor | undefined;

  beforeAll(() => {
    clientHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => mockViewportHeight,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => mockScrollHeight,
    });
  });

  beforeEach(() => {
    mockViewportHeight = 600;
    mockScrollHeight = 1000;
    mockVirtualizerSnapshots.length = 0;
  });

  afterAll(() => {
    if (clientHeightDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientHeight",
        clientHeightDescriptor,
      );
    } else {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
    if (scrollHeightDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollHeight",
        scrollHeightDescriptor,
      );
    } else {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it("keeps the Show All scrollbar and all media after collapsing and reopening", () => {
    const mediaListRef = { current: null } as React.RefObject<HTMLElement | null>;
    const mediaGridRef = {
      current: null,
    } as React.RefObject<VirtualMediaGridHandle | null>;
    const { rerender } = render(renderGrid(true, mediaListRef, mediaGridRef));

    expect(mockVirtualizerSnapshots.at(-1)).toEqual({
      count: 10,
      viewportHeight: 600,
      scrollHeight: 1000,
      virtualItemCount: 10,
      totalSize: 1000,
      starts: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900],
    });
    expect(mediaListRef.current?.scrollHeight).toBeGreaterThan(
      mediaListRef.current?.clientHeight ?? 0,
    );
    expect(screen.getAllByTestId("media-grid-tile")).toHaveLength(20);
    expect(screen.getByText("Media 20")).toBeInTheDocument();

    rerender(renderGrid(false, mediaListRef, mediaGridRef));
    expect(screen.queryByTestId("media-grid-tile")).not.toBeInTheDocument();

    mockViewportHeight = 0;
    rerender(renderGrid(true, mediaListRef, mediaGridRef));
    expect(mediaListRef.current?.clientHeight).toBe(0);
    expect(mediaListRef.current?.scrollHeight).toBe(1000);
    expect(mockVirtualizerSnapshots.at(-1)).toEqual({
      count: 10,
      viewportHeight: 0,
      scrollHeight: 1000,
      virtualItemCount: 0,
      totalSize: 1000,
      starts: [],
    });
    expect(screen.queryByText("Media 8")).not.toBeInTheDocument();

    mockViewportHeight = 600;
    rerender(renderGrid(true, mediaListRef, mediaGridRef));

    expect(mockVirtualizerSnapshots.at(-1)).toEqual({
      count: 10,
      viewportHeight: 600,
      scrollHeight: 1000,
      virtualItemCount: 10,
      totalSize: 1000,
      starts: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900],
    });
    expect(mediaListRef.current?.scrollHeight).toBeGreaterThan(
      mediaListRef.current?.clientHeight ?? 0,
    );
    expect(screen.getAllByTestId("media-grid-tile")).toHaveLength(20);
    expect(screen.getByText("Media 20")).toBeInTheDocument();
  });
});
