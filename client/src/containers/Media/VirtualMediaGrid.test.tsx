import { act, fireEvent, render, screen } from "@testing-library/react";
import { VirtualMediaGrid } from "./VirtualMediaGrid";
import type { MediaFolder, MediaType } from "../../types";

const mockVirtualizerMeasure = jest.fn();
const mockVirtualizerMeasureElement = jest.fn();
const mockVirtualizerCounts: number[] = [];
let mockFolderRowHeight = 32;
let mockTileRowHeight = 120;
let mockScrollOffset = 0;
let mockViewportHeight = Number.POSITIVE_INFINITY;
let mockNotifyObservedSizeChange: (() => void) | null = null;
const mockVirtualizerSnapshots: Array<{
  totalSize: number;
  indexes: number[];
  starts: number[];
}> = [];
const mockMeasurementPasses: string[] = [];
const mockResizeObservers: TestResizeObserver[] = [];

class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private target: Element | null = null;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    mockResizeObservers.push(this);
  }

  observe(target: Element) {
    this.target = target;
  }

  unobserve() {
    this.target = null;
  }

  disconnect() {
    this.target = null;
  }

  resize(width: number) {
    if (!this.target) return;
    this.callback(
      [
        {
          contentRect: { width } as DOMRectReadOnly,
          target: this.target,
        } as ResizeObserverEntry,
      ],
      this,
    );
  }
}

jest.mock("@tanstack/react-virtual", () => {
  const React = jest.requireActual("react") as typeof import("react");

  return {
    useVirtualizer: ({
      count,
      estimateSize,
      getItemKey,
      rangeExtractor,
    }: {
      count: number;
      estimateSize: (index: number) => number;
      getItemKey: (index: number) => string | number;
      rangeExtractor: (range: {
        startIndex: number;
        endIndex: number;
        overscan: number;
        count: number;
      }) => number[];
    }) => {
      mockVirtualizerCounts.push(count);
      const [, forceRender] = React.useState(0);
      const countRef = React.useRef(count);
      countRef.current = count;
      const estimateSizeRef = React.useRef(estimateSize);
      estimateSizeRef.current = estimateSize;
      const getItemKeyRef = React.useRef(getItemKey);
      getItemKeyRef.current = getItemKey;
      const rangeExtractorRef = React.useRef(rangeExtractor);
      rangeExtractorRef.current = rangeExtractor;
      const sizeCacheRef = React.useRef(new Map<string | number, number>());
      const observedElementsRef = React.useRef(
        new Map<string | number, HTMLElement>(),
      );
      mockNotifyObservedSizeChange = () => {
        observedElementsRef.current.forEach((element, key) => {
          if (element.dataset.rowType === "folders") {
            const index = Number(element.dataset.index);
            const { starts } = getLayout();
            const previousSize = sizeCacheRef.current.get(key) ??
              estimateSizeRef.current(index);
            const delta = mockFolderRowHeight - previousSize;
            if (starts[index] < mockScrollOffset) {
              mockScrollOffset += delta;
            }
            sizeCacheRef.current.set(key, mockFolderRowHeight);
          }
        });
        forceRender((value) => value + 1);
      };
      const getLayout = React.useCallback(() => {
        const indexes = Array.from(
          { length: countRef.current },
          (_, index) => index,
        );
        const starts = indexes.reduce<number[]>((result, index) => {
          result.push(
            (result.at(-1) ?? 0) +
              (result.length > 0
                ? sizeCacheRef.current.get(getItemKeyRef.current(index - 1)) ??
                  estimateSizeRef.current(index - 1)
                : 0),
          );
          return result;
        }, []);
        const sizes = indexes.map(
          (index) =>
            sizeCacheRef.current.get(getItemKeyRef.current(index)) ??
            estimateSizeRef.current(index),
        );
        return { indexes, starts, sizes, totalSize: sizes.reduce((a, b) => a + b, 0) };
      }, []);
      const measure = React.useCallback(() => {
        mockVirtualizerMeasure();
        mockMeasurementPasses.push("virtualizer.measure");
        const indexes = Array.from(
          { length: countRef.current },
          (_, index) => index,
        );
        sizeCacheRef.current.clear();
        mockVirtualizerSnapshots.push({
          totalSize: indexes.reduce(
            (total, index) => total + estimateSizeRef.current(index),
            0,
          ),
          indexes,
          starts: indexes.reduce<number[]>((starts, index) => {
            starts.push(
              (starts.at(-1) ?? 0) +
                (starts.length > 0 ? estimateSizeRef.current(index - 1) : 0),
            );
            return starts;
          }, []),
        });
        forceRender((value) => value + 1);
      }, [forceRender]);
      return React.useMemo(
        () => ({
          getTotalSize: () => getLayout().totalSize,
          getVirtualItems: () => {
            const { indexes, starts, sizes, totalSize } = getLayout();
            const startIndex = indexes.findIndex(
              (index) => starts[index] + sizes[index] >= mockScrollOffset,
            );
            const endIndex = indexes.find(
              (index) => starts[index] > mockScrollOffset + mockViewportHeight,
            );
            const visibleIndexes =
              startIndex === -1 || mockViewportHeight === 0
                ? []
                : rangeExtractorRef.current({
                    startIndex,
                    endIndex: endIndex ?? indexes.length - 1,
                    overscan: 3,
                    count: indexes.length,
                  });
            mockVirtualizerSnapshots.push({
              totalSize,
              indexes,
              starts,
            });
            return visibleIndexes.map((index) => ({
              index,
              key: getItemKeyRef.current(index),
              start: starts[index],
            }));
          },
          measureElement: (element: HTMLElement | null) => {
            if (!element) return;
            mockVirtualizerMeasureElement();
            mockMeasurementPasses.push("rendered-row");
            const index = Number(element.dataset.index);
            const key = getItemKeyRef.current(index);
            observedElementsRef.current.set(key, element);
            const estimatedSize = estimateSizeRef.current(index);
            let measuredSize = estimatedSize;
            if (element.dataset.rowType === "tiles") {
              measuredSize = mockTileRowHeight;
            }
            if (element.dataset.rowType === "folders") {
              measuredSize = mockFolderRowHeight;
            }
            sizeCacheRef.current.set(key, measuredSize);
            forceRender((value) => value + 1);
          },
          measure,
          scrollToIndex: jest.fn(),
        }),
        [forceRender, getLayout, measure],
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

const mediaItem = {
  id: "media-1",
  name: "Welcome",
  type: "image",
} as MediaType;
const secondMediaItem = {
  id: "media-2",
  name: "Goodbye",
  type: "image",
} as MediaType;

type GridTestOptions = {
  mediaItems?: MediaType[];
  cols?: number;
  showBottomName?: boolean;
  showFolders?: boolean;
  childFolders?: MediaFolder[];
  canGoUp?: boolean;
  currentFolderName?: string;
  onGoUp?: () => void;
  onOpenFolder?: (folderId: string) => void;
};

const grid = ({
  mediaItems = [mediaItem],
  cols = 1,
  showBottomName = false,
  showFolders = false,
  childFolders = [],
  canGoUp = false,
  currentFolderName,
  onGoUp = jest.fn(),
  onOpenFolder = jest.fn(),
}: GridTestOptions = {}) => (
  <VirtualMediaGrid
    scrollRef={{ current: null }}
    mediaItems={mediaItems}
    cols={cols}
    showFolders={showFolders}
    childFolders={childFolders}
    canGoUp={canGoUp}
    currentFolderName={currentFolderName}
    onGoUp={onGoUp}
    onOpenFolder={onOpenFolder}
    selectedMedia={{} as MediaType}
    selectedMediaIds={new Set()}
    mediaMultiSelectMode={false}
    onMediaTileClick={jest.fn()}
    onEnterMediaMultiSelectMode={jest.fn()}
    showBottomName={showBottomName}
  />
);

describe("VirtualMediaGrid", () => {
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeAll(() => {
    getBoundingClientRectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const text = this.textContent ?? "";
        const isFolderRow = this.dataset.rowType === "folders";
        const isTileRow =
          this.dataset.rowType === "tiles" ||
          text.includes("Media") ||
          text.includes("Welcome") ||
          text.includes("Goodbye");
        const height = isFolderRow
          ? mockFolderRowHeight
          : isTileRow
            ? mockTileRowHeight
            : 28;
        return {
          bottom: height,
          height,
          left: 0,
          right: 100,
          toJSON: () => ({}),
          top: 0,
          width: 100,
          x: 0,
          y: 0,
        } as DOMRect;
      });
  });

  afterAll(() => {
    getBoundingClientRectSpy.mockRestore();
  });

  beforeEach(() => {
    mockVirtualizerCounts.length = 0;
    mockFolderRowHeight = 32;
    mockTileRowHeight = 120;
    mockScrollOffset = 0;
    mockViewportHeight = Number.POSITIVE_INFINITY;
    mockNotifyObservedSizeChange = null;
    mockVirtualizerMeasure.mockClear();
    mockVirtualizerMeasureElement.mockClear();
    mockVirtualizerSnapshots.length = 0;
    mockMeasurementPasses.length = 0;
    mockResizeObservers.length = 0;
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: TestResizeObserver,
    });
  });

  it("does not loop when virtualizer measurement causes a rerender", () => {
    expect(() => render(grid())).not.toThrow();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("flushes virtualizer measurements when Show All receives more media while mounted", () => {
    const { rerender } = render(grid({ mediaItems: [mediaItem] }));

    rerender(grid({ mediaItems: [mediaItem, secondMediaItem] }));

    expect(mockVirtualizerCounts).toContain(1);
    expect(mockVirtualizerCounts).toContain(2);
    expect(screen.getByText("Goodbye")).toBeInTheDocument();
  });

  it("does not reposition settled rows during an equivalent media snapshot", () => {
    const initialMediaItems = [mediaItem, secondMediaItem];
    const { rerender } = render(
      grid({ mediaItems: initialMediaItems, cols: 1 }),
    );
    const settledSnapshot = mockVirtualizerSnapshots.at(-1);
    mockVirtualizerSnapshots.length = 0;
    mockMeasurementPasses.length = 0;

    rerender(
      grid({ mediaItems: [...initialMediaItems], cols: 1 }),
    );

    expect(settledSnapshot).toEqual({
      totalSize: 240,
      indexes: [0, 1],
      starts: [0, 120],
    });
    expect(mockMeasurementPasses).not.toContain("virtualizer.measure");
    expect(mockMeasurementPasses).toEqual([]);
    expect(mockVirtualizerSnapshots).toEqual([
      {
        totalSize: 240,
        indexes: [0, 1],
        starts: [0, 120],
      },
    ]);
  });

  it("keeps folder navigation rows interactive", () => {
    const onOpenFolder = jest.fn();
    const folder = {
      id: "folder-1",
      name: "Backgrounds",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    } as MediaFolder;

    render(
      grid({
        mediaItems: [],
        showFolders: true,
        childFolders: [folder],
        onOpenFolder,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Backgrounds" }));

    expect(onOpenFolder).toHaveBeenCalledWith("folder-1");
  });

  it("renders compact folders together in one wrapping row below Up", () => {
    const folders = ["Backgrounds", "Videos", "Logos"].map((name, index) => ({
      id: `folder-${index}`,
      name,
      parentId: null,
      createdAt: "",
      updatedAt: "",
    })) as MediaFolder[];
    const onGoUp = jest.fn();

    render(
      grid({
        mediaItems: [],
        showFolders: true,
        childFolders: folders,
        canGoUp: true,
        currentFolderName: "Nested folder",
        onGoUp,
      }),
    );

    const folderButtons = folders.map((folder) =>
      screen.getByRole("button", { name: folder.name }),
    );
    const folderGrid = screen.getByTestId("media-library-folder-grid");

    expect(folderGrid).toHaveClass("flex", "flex-wrap", "gap-2");
    expect(screen.getAllByTestId("media-library-folder-grid")).toHaveLength(1);
    expect(mockVirtualizerCounts).toContain(2);
    expect(folderButtons.map((button) => button.textContent)).toEqual([
      "Backgrounds",
      "Videos",
      "Logos",
    ]);
    expect(screen.getByRole("button", { name: "Up" })).toBeInTheDocument();
    expect(screen.getByText("Nested folder")).toBeInTheDocument();
    const buttonNames = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttonNames.indexOf("Up")).toBeLessThan(buttonNames.indexOf("Backgrounds"));

    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    expect(onGoUp).toHaveBeenCalledTimes(1);
  });

  it("uses the complete wrapped folder height before positioning thumbnails", () => {
    const folder = {
      id: "folder-before-media",
      name: "Folder",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    } as MediaFolder;

    mockFolderRowHeight = 68;
    render(
      grid({
        mediaItems: [mediaItem, secondMediaItem],
        cols: 1,
        showFolders: true,
        childFolders: [folder],
        canGoUp: true,
        currentFolderName: "Nested",
      }),
    );

    const snapshot = mockVirtualizerSnapshots.at(-1);
    expect(snapshot?.indexes).toEqual([0, 1, 2, 3]);
    expect(mockVirtualizerMeasureElement).toHaveBeenCalled();
    expect(snapshot?.starts[2]).toBeGreaterThanOrEqual(
      (snapshot?.starts[1] ?? 0) + mockFolderRowHeight,
    );
  });

  it("keeps long folder names constrained inside the wrapping row", () => {
    const folder = {
      id: "long-folder",
      name: "A folder name that is much longer than the available panel width",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    } as MediaFolder;

    render(grid({ mediaItems: [], showFolders: true, childFolders: [folder] }));

    const chip = screen.getByRole("button", { name: folder.name });
    const label = screen.getByText(folder.name);
    expect(chip).toHaveClass(
      "max-w-full",
      "min-w-0",
      "shrink",
      "max-md:min-h-8",
    );
    expect(label).toHaveClass("min-w-0", "truncate");
  });

  it("updates an offscreen wrapping folder row after a width change without clearing other measurements", () => {
    const folder = {
      id: "one-folder",
      name: "One",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    } as MediaFolder;
    const { rerender } = render(
      grid({
        mediaItems: Array.from({ length: 30 }, (_, index) => ({
          id: `scrolled-${index}`,
          name: `Scrolled ${index}`,
          type: "image",
        })) as MediaType[],
        cols: 1,
        showFolders: true,
        childFolders: [folder],
      }),
    );

    expect(mockResizeObservers).toHaveLength(1);
    mockViewportHeight = 180;
    mockScrollOffset = 700;
    mockFolderRowHeight = 68;
    act(() => {
      mockResizeObservers[0].resize(320);
      mockNotifyObservedSizeChange?.();
    });
    expect(screen.getByTestId("media-library-folder-grid")).toBeInTheDocument();
    expect(mockVirtualizerMeasure).not.toHaveBeenCalled();
    expect(mockScrollOffset).toBe(736);
    expect(screen.getByText("Scrolled 5")).toBeInTheDocument();
    expect(mockVirtualizerSnapshots.at(-1)?.totalSize).toBeGreaterThan(68);
    expect(mockVirtualizerSnapshots.at(-1)?.starts[1]).toBeGreaterThanOrEqual(68);

    mockScrollOffset = 0;
    rerender(
      grid({
        mediaItems: [mediaItem, secondMediaItem],
        cols: 1,
        showFolders: true,
        childFolders: [
          folder,
          { ...folder, id: "second-folder", name: "Two" },
          { ...folder, id: "third-folder", name: "Three" },
        ],
      }),
    );

    expect(mockVirtualizerMeasure).not.toHaveBeenCalled();
    expect(screen.getByText("Goodbye")).toBeInTheDocument();
    expect(mockVirtualizerSnapshots.at(-1)?.starts[1]).toBe(68);
    expect(screen.getByRole("button", { name: "Three" })).toBeInTheDocument();
  });

  it("does not invalidate measurements for equivalent folder contents", () => {
    const folder = {
      id: "same-folder",
      name: "Same name",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    } as MediaFolder;
    const { rerender } = render(
      grid({ mediaItems: [], showFolders: true, childFolders: [folder] }),
    );
    mockVirtualizerMeasure.mockClear();
    mockMeasurementPasses.length = 0;

    rerender(
      grid({
        mediaItems: [],
        showFolders: true,
        childFolders: [{ ...folder }],
      }),
    );

    expect(mockVirtualizerMeasure).not.toHaveBeenCalled();
    expect(mockMeasurementPasses).not.toContain("virtualizer.measure");
    expect(mockMeasurementPasses).toEqual([]);
  });

  it("keeps empty folders visible and virtualizes their media rows after navigation", () => {
    const emptyFolder = {
      id: "empty-folder",
      name: "Empty folder",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    } as MediaFolder;
    const manyItems = Array.from({ length: 25 }, (_, index) => ({
      id: `child-${index}`,
      name: `Child ${index}`,
      type: "image",
    })) as MediaType[];
    const onOpenFolder = jest.fn();
    const { rerender } = render(
      grid({
        mediaItems: [],
        showFolders: true,
        childFolders: [emptyFolder],
        onOpenFolder,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Empty folder" }));
    expect(onOpenFolder).toHaveBeenCalledWith("empty-folder");

    rerender(
      grid({
        mediaItems: manyItems,
        cols: 5,
        showFolders: true,
        canGoUp: true,
        currentFolderName: "Empty folder",
        childFolders: [],
      }),
    );

    expect(mockVirtualizerCounts.at(-1)).toBe(6);
    expect(screen.getByRole("button", { name: "Up" })).toBeInTheDocument();
    expect(screen.getByText("Child 24")).toBeInTheDocument();
  });

  it("recalculates total row height when folders are replaced by Show All rows", () => {
    const folders = Array.from(
      { length: 10 },
      (_, index) => `folder-${index}`,
    ).map(
      (name, index) => ({
        id: `folder-${index}`,
        name,
        parentId: null,
        createdAt: "",
        updatedAt: "",
      }),
    ) as MediaFolder[];
    const mediaItems = Array.from({ length: 8 }, (_, index) => ({
      id: `media-${index}`,
      name: `Media ${index}`,
      type: "image",
    })) as MediaType[];
    const { rerender } = render(
      grid({
        mediaItems: [],
        cols: 2,
        showFolders: true,
        childFolders: folders,
      }),
    );
    mockVirtualizerSnapshots.length = 0;
    mockMeasurementPasses.length = 0;

    rerender(
      grid({
        mediaItems,
        cols: 2,
        showFolders: false,
        childFolders: [],
      }),
    );

    expect(mockVirtualizerSnapshots.at(-1)).toEqual({
      totalSize: 480,
      indexes: [0, 1, 2, 3],
      starts: [0, 120, 240, 360],
    });
    expect(mockMeasurementPasses.filter((pass) => pass === "virtualizer.measure"))
      .toEqual([]);
  });

  it("refreshes row measurements when the grid column count changes", () => {
    const { rerender } = render(
      grid({ mediaItems: [mediaItem, secondMediaItem], cols: 1 }),
    );

    rerender(grid({ mediaItems: [mediaItem, secondMediaItem], cols: 2 }));

    expect(mockVirtualizerMeasure).not.toHaveBeenCalled();
    expect(mockVirtualizerCounts).toContain(2);
    expect(mockVirtualizerCounts).toContain(1);
  });

  it("keeps folder wrapping independent from thumbnail zoom", () => {
    const folder = {
      id: "zoom-folder",
      name: "Folder",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    } as MediaFolder;
    const { rerender } = render(
      grid({
        mediaItems: [mediaItem, secondMediaItem],
        cols: 1,
        showFolders: true,
        childFolders: [folder],
      }),
    );

    rerender(
      grid({
        mediaItems: [mediaItem, secondMediaItem],
        cols: 2,
        showFolders: true,
        childFolders: [folder],
      }),
    );

    expect(screen.getAllByTestId("media-library-folder-grid")).toHaveLength(1);
    expect(screen.getByTestId("media-library-folder-grid")).toHaveClass(
      "flex-wrap",
      "gap-2",
    );
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Goodbye")).toBeInTheDocument();
  });

  it("keeps the scroll position and visible media stable when zoom changes while scrolled down", () => {
    const manyItems = Array.from({ length: 30 }, (_, index) => ({
      id: `zoom-media-${index}`,
      name: `Zoom Media ${index}`,
      type: "image",
    })) as MediaType[];
    const { rerender } = render(
      grid({ mediaItems: manyItems, cols: 1 }),
    );
    mockViewportHeight = 180;
    mockScrollOffset = 720;

    rerender(grid({ mediaItems: manyItems, cols: 3 }));

    expect(mockScrollOffset).toBe(720);
    expect(mockVirtualizerMeasure).not.toHaveBeenCalled();
    expect(screen.getByText("Zoom Media 21")).toBeInTheDocument();
    expect(mockVirtualizerSnapshots.at(-1)?.totalSize).toBeLessThan(30 * 120);
  });

  it("remeasures changed thumbnail labels and dimensions without discarding the folder height", () => {
    const folder = {
      id: "stable-folder",
      name: "Stable folder",
      parentId: null,
      createdAt: "",
      updatedAt: "",
    } as MediaFolder;
    const { rerender } = render(
      grid({
        mediaItems: [mediaItem, secondMediaItem],
        showFolders: true,
        childFolders: [folder],
      }),
    );
    mockFolderRowHeight = 68;
    act(() => mockNotifyObservedSizeChange?.());
    mockTileRowHeight = 144;
    mockMeasurementPasses.length = 0;

    rerender(
      grid({
        mediaItems: [
          { ...mediaItem, name: "A longer displayed thumbnail name" },
          { ...secondMediaItem, name: "Another displayed thumbnail name" },
        ],
        showFolders: true,
        childFolders: [{ ...folder }],
        showBottomName: true,
      }),
    );

    const snapshot = mockVirtualizerSnapshots.at(-1);
    expect(mockVirtualizerMeasure).not.toHaveBeenCalled();
    expect(mockMeasurementPasses).toContain("rendered-row");
    expect(snapshot?.starts[1]).toBe(68);
    expect(snapshot?.starts[2]).toBe(68 + 144);
    expect(screen.getByText("A longer displayed thumbnail name")).toBeInTheDocument();
  });
});
