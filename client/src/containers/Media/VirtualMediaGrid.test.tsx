import { fireEvent, render, screen } from "@testing-library/react";
import { VirtualMediaGrid } from "./VirtualMediaGrid";
import type { MediaFolder, MediaType } from "../../types";

const mockVirtualizerMeasure = jest.fn();
const mockVirtualizerMeasureElement = jest.fn();
const mockVirtualizerCounts: number[] = [];
const mockVirtualizerSnapshots: Array<{
  totalSize: number;
  indexes: number[];
  starts: number[];
}> = [];
const mockMeasurementPasses: string[] = [];

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
      mockVirtualizerCounts.push(count);
      const [, forceRender] = React.useState(0);
      const countRef = React.useRef(count);
      countRef.current = count;
      const estimateSizeRef = React.useRef(estimateSize);
      estimateSizeRef.current = estimateSize;
      const sizeCacheRef = React.useRef(new Map<number, number>());
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
          getTotalSize: () =>
            Array.from({ length: countRef.current }, (_, index) => index).reduce(
              (total, index) =>
                total +
                (sizeCacheRef.current.get(index) ??
                  estimateSizeRef.current(index)),
              0,
            ),
          getVirtualItems: () => {
            const indexes = Array.from(
              { length: countRef.current },
              (_, index) => index,
            );
            const starts = indexes.reduce<number[]>((result, index) => {
              result.push(
                (result.at(-1) ?? 0) +
                  (result.length > 0
                    ? sizeCacheRef.current.get(index - 1) ??
                      estimateSizeRef.current(index - 1)
                    : 0),
              );
              return result;
            }, []);
            mockVirtualizerSnapshots.push({
              totalSize: indexes.reduce(
                (total, index) =>
                  total +
                  (sizeCacheRef.current.get(index) ??
                    estimateSizeRef.current(index)),
                0,
              ),
              indexes,
              starts,
            });
            return indexes.map((index) => ({
              index,
              key: String(index),
              start: starts[index],
            }));
          },
          measureElement: (element: HTMLElement | null) => {
            if (!element) return;
            mockVirtualizerMeasureElement();
            mockMeasurementPasses.push("rendered-row");
            const index = Number(element.dataset.index);
            const estimatedSize = estimateSizeRef.current(index);
            sizeCacheRef.current.set(
              index,
              estimatedSize === 28 ? estimatedSize : 120,
            );
            forceRender((value) => value + 1);
          },
          measure,
          scrollToIndex: jest.fn(),
        }),
        [forceRender, measure],
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
  showFolders?: boolean;
  childFolders?: MediaFolder[];
  onOpenFolder?: (folderId: string) => void;
};

const grid = ({
  mediaItems = [mediaItem],
  cols = 1,
  showFolders = false,
  childFolders = [],
  onOpenFolder = jest.fn(),
}: GridTestOptions = {}) => (
  <VirtualMediaGrid
    scrollRef={{ current: null }}
    mediaItems={mediaItems}
    cols={cols}
    showFolders={showFolders}
    childFolders={childFolders}
    canGoUp={false}
    onGoUp={jest.fn()}
    onOpenFolder={onOpenFolder}
    selectedMedia={{} as MediaType}
    selectedMediaIds={new Set()}
    mediaMultiSelectMode={false}
    onMediaTileClick={jest.fn()}
    onEnterMediaMultiSelectMode={jest.fn()}
    showBottomName={false}
  />
);

describe("VirtualMediaGrid", () => {
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeAll(() => {
    getBoundingClientRectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const text = this.textContent ?? "";
        const isTileRow =
          text.includes("Media") || text.includes("Welcome") || text.includes("Goodbye");
        return {
          bottom: isTileRow ? 120 : 28,
          height: isTileRow ? 120 : 28,
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
    mockVirtualizerMeasure.mockClear();
    mockVirtualizerMeasureElement.mockClear();
    mockVirtualizerSnapshots.length = 0;
    mockMeasurementPasses.length = 0;
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
      totalSize: 320,
      indexes: [0, 1, 2, 3],
      starts: [0, 80, 160, 240],
    });
    expect(mockMeasurementPasses).toEqual(["virtualizer.measure"]);
  });

  it("refreshes row measurements when the grid column count changes", () => {
    const { rerender } = render(
      grid({ mediaItems: [mediaItem, secondMediaItem], cols: 1 }),
    );

    rerender(grid({ mediaItems: [mediaItem, secondMediaItem], cols: 2 }));

    expect(mockVirtualizerMeasure).toHaveBeenCalled();
    expect(mockVirtualizerCounts).toContain(2);
    expect(mockVirtualizerCounts).toContain(1);
  });
});
