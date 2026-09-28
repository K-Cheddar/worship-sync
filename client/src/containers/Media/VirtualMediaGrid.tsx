import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MediaFolder, MediaType } from "../../types";
import MediaLibraryGridMediaTile from "./MediaLibraryGridMediaTile";
import {
  MediaLibraryFolderChip,
  MediaLibraryUpChip,
} from "./MediaLibraryFolderChip";

const COL_GAP = 8;  // gap-x-2
const ROW_GAP = 4;  // gap-y-1
const FOLDER_ROW_ESTIMATE_HEIGHT = 32;
const INITIAL_TILE_ROW_HEIGHT = 80; // fallback before first real measurement

const getUsableScrollViewport = (element: HTMLElement | null) => {
  if (!element || element.isConnected === false) return 0;

  try {
    const rectHeight = element.getBoundingClientRect().height;
    return Math.max(element.clientHeight, rectHeight);
  } catch {
    return 0;
  }
};

const findMediaElement = (container: HTMLElement, id: string) =>
  Array.from(
    container.querySelectorAll<HTMLElement>("[data-media-id]"),
  ).find((element) => element.dataset.mediaId === id) ?? null;

type UpRow = { type: "up"; label: string };
type FoldersRow = { type: "folders"; folders: MediaFolder[] };
type TilesRow = { type: "tiles"; items: MediaType[]; startIndex: number };
type VirtualRow = UpRow | FoldersRow | TilesRow;

export type VirtualMediaGridHandle = {
  scrollToMediaId: (
    id: string,
    options?: { signal?: AbortSignal },
  ) => Promise<VirtualMediaGridScrollResult>;
};

export type VirtualMediaGridScrollResult =
  | { status: "success" }
  | { status: "not-ready" }
  | { status: "not-found" }
  | { status: "cancelled" };

export type VirtualMediaGridProps = {
  scrollRef: React.RefObject<HTMLElement | null>;
  scrollElement?: HTMLElement | null;
  mediaItems: MediaType[];
  cols: number;
  showFolders: boolean;
  childFolders: MediaFolder[];
  canGoUp: boolean;
  currentFolderName?: string;
  onGoUp: () => void;
  onOpenFolder: (folderId: string) => void;
  selectedMedia: MediaType;
  selectedMediaIds: Set<string>;
  mediaMultiSelectMode: boolean;
  onMediaTileClick: (e: React.MouseEvent, item: MediaType, index: number) => void;
  onEnterMediaMultiSelectMode: (
    item: MediaType,
    index: number,
    opts?: { skipNextClick?: boolean },
  ) => void;
  showBottomName: boolean;
  bottomNameClassName?: string;
  imageContainerClassName?: string;
  mediaDragEnabled?: boolean;
  orderedSelectedMediaIds?: string[];
};

export const VirtualMediaGrid = forwardRef<VirtualMediaGridHandle, VirtualMediaGridProps>(
  (
    {
      scrollRef,
      scrollElement,
      mediaItems,
      cols,
      showFolders,
      childFolders,
      canGoUp,
      currentFolderName,
      onGoUp,
      onOpenFolder,
      selectedMedia,
      selectedMediaIds,
      mediaMultiSelectMode,
      onMediaTileClick,
      onEnterMediaMultiSelectMode,
      showBottomName,
      bottomNameClassName,
      imageContainerClassName,
      mediaDragEnabled = false,
      orderedSelectedMediaIds = [],
    },
    ref,
  ) => {
    // Keep a measured tile row height as the estimate for rows that have not
    // been rendered yet. Individual row measurements remain owned by TanStack.
    const [tileRowHeight, setTileRowHeight] = useState(INITIAL_TILE_ROW_HEIGHT);
    const tileRowHeightRef = useRef(tileRowHeight);
    tileRowHeightRef.current = tileRowHeight;
    const [gridWidth, setGridWidth] = useState(0);
    const gridRef = useRef<HTMLDivElement>(null);
    const tileLayoutKey = JSON.stringify([
      showBottomName,
      bottomNameClassName ?? "",
      imageContainerClassName ?? "",
    ]);
    const rows = useMemo<VirtualRow[]>(() => {
      const result: VirtualRow[] = [];
      if (showFolders) {
        if (canGoUp) result.push({ type: "up", label: currentFolderName ?? "" });
        if (childFolders.length > 0) {
          result.push({ type: "folders", folders: childFolders });
        }
      }
      for (let i = 0; i < mediaItems.length; i += cols) {
        result.push({ type: "tiles", items: mediaItems.slice(i, i + cols), startIndex: i });
      }
      return result;
    }, [showFolders, canGoUp, currentFolderName, childFolders, mediaItems, cols]);

    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const mediaItemsRef = useRef(mediaItems);
    mediaItemsRef.current = mediaItems;

    const rowKeys = useMemo(
      () =>
        rows.map((row) => {
          if (row.type === "up") return `up:${row.label}`;
          if (row.type === "folders") {
            return `folders:${JSON.stringify(
              row.folders.map(({ id, name }) => [id, name]),
            )}`;
          }
          return `tiles:${JSON.stringify([
            cols,
            gridWidth,
            tileLayoutKey,
            row.items.map(({ id, name }) => [
              id,
              showBottomName ? name : "",
            ]),
          ])}`;
        }),
      [cols, gridWidth, rows, showBottomName, tileLayoutKey],
    );
    const rowKeysRef = useRef(rowKeys);
    rowKeysRef.current = rowKeys;
    const rowKeySignature = useMemo(() => JSON.stringify(rowKeys), [rowKeys]);
    const folderRowIndex = useMemo(
      () => rows.findIndex((row) => row.type === "folders"),
      [rows],
    );
    const getRowKey = useCallback(
      (index: number) =>
        rowKeysRef.current[index] ??
        `${rowKeySignature}:${tileRowHeight}:${index}`,
      [rowKeySignature, tileRowHeight],
    );
    const rangeExtractor = useCallback(
      ({ startIndex, endIndex, overscan, count }: {
        startIndex: number;
        endIndex: number;
        overscan: number;
        count: number;
      }) => {
        const first = Math.max(startIndex - overscan, 0);
        const last = Math.min(endIndex + overscan, count - 1);
        const indexes = Array.from(
          { length: Math.max(last - first + 1, 0) },
          (_, offset) => first + offset,
        );
        if (folderRowIndex >= 0 && !indexes.includes(folderRowIndex)) {
          indexes.push(folderRowIndex);
          indexes.sort((a, b) => a - b);
        }
        return indexes;
      },
      [folderRowIndex],
    );

    const virtualizer = useVirtualizer({
      count: rows.length,
      getItemKey: getRowKey,
      getScrollElement: () =>
        scrollElement === undefined ? scrollRef.current : scrollElement,
      estimateSize: (index) =>
        rowsRef.current[index]?.type === "tiles"
          ? tileRowHeightRef.current
          : FOLDER_ROW_ESTIMATE_HEIGHT,
      rangeExtractor,
      overscan: 3,
      paddingStart: 16,
      paddingEnd: 16,
      gap: ROW_GAP,
    });

    const virtualizerRef = useRef(virtualizer);
    virtualizerRef.current = virtualizer;

    const measureRowElement = useCallback((el: HTMLDivElement | null) => {
      virtualizerRef.current.measureElement(el);
      if (!el) return;

      const row = rowsRef.current[Number(el.dataset.index)];
      // Measured tile rows provide a current estimate for unrendered rows.
      if (row?.type === "tiles") {
        const h = el.getBoundingClientRect().height;
        if (h > 0 && Math.abs(h - tileRowHeightRef.current) > 1) {
          tileRowHeightRef.current = h;
          setTileRowHeight(h);
        }
      }
    }, []);

    // The folder row stays in the virtual range even offscreen, so TanStack's
    // row ResizeObserver can update its wrapping height without clearing the
    // size cache for every other row.
    useLayoutEffect(() => {
      const gridElement = gridRef.current;
      if (!gridElement || typeof ResizeObserver === "undefined") return;

      let previousWidth = gridElement.getBoundingClientRect().width;
      const resizeObserver = new ResizeObserver(([entry]) => {
        const nextWidth = entry?.contentRect.width ?? 0;
        if (Math.abs(nextWidth - previousWidth) <= 1) return;

        previousWidth = nextWidth;
        setGridWidth(Math.round(nextWidth));
      });
      resizeObserver.observe(gridElement);

      return () => resizeObserver.disconnect();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        scrollToMediaId(
          id: string,
          { signal }: { signal?: AbortSignal } = {},
        ) {
          const targetExists = mediaItemsRef.current.some((item) => item.id === id);
          const rowIndex = rowsRef.current.findIndex(
            (r) => r.type === "tiles" && r.items.some((item) => item.id === id),
          );
          if (!targetExists) return Promise.resolve({ status: "not-found" });
          if (rowIndex === -1) return Promise.resolve({ status: "not-ready" });
          if (signal?.aborted) return Promise.resolve({ status: "cancelled" });

          const scrollContainer =
            scrollElement === undefined ? scrollRef.current : scrollElement;
          if (getUsableScrollViewport(scrollContainer) === 0) {
            return Promise.resolve({ status: "not-ready" });
          }

          virtualizerRef.current.scrollToIndex(rowIndex, { align: "auto" });

          return new Promise<VirtualMediaGridScrollResult>((resolve) => {
            let frameId: number | null = null;
            let settled = false;

            const cleanup = () => {
              if (frameId !== null) cancelAnimationFrame(frameId);
              signal?.removeEventListener("abort", handleAbort);
            };
            const finish = (result: VirtualMediaGridScrollResult) => {
              if (settled) return;
              settled = true;
              cleanup();
              resolve(result);
            };
            const handleAbort = () => finish({ status: "cancelled" });
            const checkForMountedTile = () => {
              if (signal?.aborted) {
                handleAbort();
                return;
              }

              const targetStillExists = mediaItemsRef.current.some(
                (item) => item.id === id,
              );
              if (!targetStillExists) {
                finish({ status: "not-found" });
                return;
              }

              const currentScrollContainer =
                scrollElement === undefined ? scrollRef.current : scrollElement;
              if (getUsableScrollViewport(currentScrollContainer) === 0) {
                finish({ status: "not-ready" });
                return;
              }
              if (!currentScrollContainer) {
                finish({ status: "not-ready" });
                return;
              }

              const mediaElement = findMediaElement(currentScrollContainer, id);
              if (mediaElement) {
                const containerRect =
                  currentScrollContainer.getBoundingClientRect();
                const mediaRect = mediaElement.getBoundingClientRect();
                const viewportTop = containerRect.top;
                const viewportBottom =
                  containerRect.height > 0
                    ? containerRect.bottom
                    : viewportTop + currentScrollContainer.clientHeight;
                const isOutsideViewport =
                  mediaRect.top < viewportTop || mediaRect.bottom > viewportBottom;

                if (isOutsideViewport) {
                  mediaElement.scrollIntoView({
                    block: "nearest",
                    behavior: "smooth",
                  });
                }
                finish({ status: "success" });
                return;
              }

              frameId = requestAnimationFrame(() => {
                frameId = null;
                checkForMountedTile();
              });
            };

            signal?.addEventListener("abort", handleAbort, { once: true });
            checkForMountedTile();
          });
        },
      }),
      [scrollElement, scrollRef],
    );

    return (
      <div
        ref={gridRef}
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              data-row-type={row.type}
              ref={measureRowElement}
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.type === "up" && (
                <div className="px-4">
                  <MediaLibraryUpChip
                    currentFolderName={row.label}
                    onGoUp={onGoUp}
                  />
                </div>
              )}
              {row.type === "folders" && (
                <div
                  data-testid="media-library-folder-grid"
                  className="flex min-w-0 flex-wrap items-start gap-2 px-4"
                >
                  {row.folders.map((folder) => (
                    <MediaLibraryFolderChip
                      key={folder.id}
                      folder={folder}
                      onOpen={onOpenFolder}
                    />
                  ))}
                </div>
              )}
              {row.type === "tiles" && (
                <div
                  className="px-4"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    columnGap: COL_GAP,
                  }}
                >
                  {row.items.map((item, i) => (
                    <div key={item.id} data-media-id={item.id}>
                      <MediaLibraryGridMediaTile
                        mediaItem={item}
                        index={row.startIndex + i}
                        isSelected={item.id === selectedMedia.id}
                        isMultiSelected={selectedMediaIds.has(item.id)}
                        mediaMultiSelectMode={mediaMultiSelectMode}
                        onMediaTileClick={onMediaTileClick}
                        onEnterMediaMultiSelectMode={onEnterMediaMultiSelectMode}
                        showBottomName={showBottomName}
                        bottomNameClassName={bottomNameClassName}
                        imageContainerClassName={imageContainerClassName}
                        mediaDragEnabled={mediaDragEnabled}
                        orderedSelectedMediaIds={orderedSelectedMediaIds}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);

VirtualMediaGrid.displayName = "VirtualMediaGrid";
