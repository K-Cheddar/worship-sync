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
import Button from "../../components/Button/Button";
import { ArrowUp, Folder } from "lucide-react";
import {
  MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS,
  MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS,
  MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE,
} from "./mediaLibraryOrangeFolderIcon";

const COL_GAP = 8;  // gap-x-2
const ROW_GAP = 4;  // gap-y-1
const FOLDER_ROW_HEIGHT = 28;
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
type FolderRow = { type: "folder"; folder: MediaFolder };
type TilesRow = { type: "tiles"; items: MediaType[]; startIndex: number };
type VirtualRow = UpRow | FolderRow | TilesRow;

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
    // Start with a fallback height. The first time a tile row renders and is
    // measured, we update this to the real height and call virtualizer.measure()
    // to flush the stale estimates. This avoids relying on a ResizeObserver to
    // compute containerWidth (which fails inside Radix dialog portals).
    const [tileRowHeight, setTileRowHeight] = useState(INITIAL_TILE_ROW_HEIGHT);
    const tileRowHeightRef = useRef(tileRowHeight);
    tileRowHeightRef.current = tileRowHeight;
    const shouldSyncTileRowHeightRef = useRef(true);
    const gridRef = useRef<HTMLDivElement>(null);
    const rows = useMemo<VirtualRow[]>(() => {
      const result: VirtualRow[] = [];
      if (showFolders) {
        if (canGoUp) result.push({ type: "up", label: currentFolderName ?? "" });
        for (const folder of childFolders) result.push({ type: "folder", folder });
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

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () =>
        scrollElement === undefined ? scrollRef.current : scrollElement,
      estimateSize: (index) =>
        rowsRef.current[index]?.type === "tiles" ? tileRowHeightRef.current : FOLDER_ROW_HEIGHT,
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
      // Update the tile height estimate from the first real measurement.
      if (row?.type === "tiles" && shouldSyncTileRowHeightRef.current) {
        const h = el.getBoundingClientRect().height;
        if (h > 0) {
          shouldSyncTileRowHeightRef.current = false;
          if (Math.abs(h - tileRowHeightRef.current) > 1) {
            setTileRowHeight(h);
          }
        }
      }
    }, []);

    const measureVisibleRows = useCallback(() => {
      gridRef.current
        ?.querySelectorAll<HTMLDivElement>("[data-index]")
        .forEach(measureRowElement);
    }, [measureRowElement]);

    // Folder rows have a different fixed size than tile rows. Invalidate the
    // index-based cache only when that folder-row prefix changes; media
    // updates keep the shared tile estimate and need no row remeasurement.
    const folderRowCount = showFolders
      ? childFolders.length + (canGoUp ? 1 : 0)
      : 0;
    const previousFolderRowCountRef = useRef(folderRowCount);
    useLayoutEffect(() => {
      if (previousFolderRowCountRef.current === folderRowCount) return;
      previousFolderRowCountRef.current = folderRowCount;
      virtualizerRef.current.measure();
    }, [folderRowCount]);

    // Flush stale size cache when the measured tile height changes.
    const prevTileRowHeightRef = useRef(tileRowHeight);
    useLayoutEffect(() => {
      if (prevTileRowHeightRef.current !== tileRowHeight) {
        prevTileRowHeightRef.current = tileRowHeight;
        virtualizerRef.current.measure();
      }
    }, [tileRowHeight]);

    // When cols change (zoom), reset the measured height so the next render
    // re-measures tiles at their new size and flushes the cache.
    const prevColsRef = useRef(cols);
    useLayoutEffect(() => {
      if (prevColsRef.current !== cols) {
        prevColsRef.current = cols;
        shouldSyncTileRowHeightRef.current = true;
        setTileRowHeight(INITIAL_TILE_ROW_HEIGHT);
        prevTileRowHeightRef.current = INITIAL_TILE_ROW_HEIGHT;
        virtualizerRef.current.measure();
        measureVisibleRows();
      }
    }, [cols, measureVisibleRows]);

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
              ref={measureRowElement}
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.type === "up" && (
                <div className="flex items-center gap-2 px-4 py-0.5">
                  <Button
                    variant="none"
                    padding="p-0"
                    className={MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS}
                    onClick={onGoUp}
                    title="Up one level"
                  >
                    <ArrowUp className="h-3.5 w-3.5 shrink-0 text-zinc-200" aria-hidden />
                    <span className={MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS}>Up</span>
                  </Button>
                  {row.label && <p className="text-xs text-zinc-200">{row.label}</p>}
                </div>
              )}
              {row.type === "folder" && (
                <div className="flex items-center px-4 py-0.5">
                  <Button
                    variant="none"
                    padding="p-0"
                    className={MEDIA_LIBRARY_FOLDER_CHIP_BUTTON_CLASS}
                    onClick={() => onOpenFolder(row.folder.id)}
                    title={row.folder.name}
                  >
                    <Folder
                      {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
                      className="h-3.5 w-3.5 shrink-0 text-orange-400"
                      aria-hidden
                    />
                    <span className={MEDIA_LIBRARY_FOLDER_CHIP_LABEL_CLASS}>{row.folder.name}</span>
                  </Button>
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
