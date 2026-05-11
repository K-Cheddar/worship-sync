import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MediaFolder, MediaType } from "../../types";
import MediaLibraryGridMediaTile from "./MediaLibraryGridMediaTile";
import Button from "../../components/Button/Button";
import { ArrowUp, Folder } from "lucide-react";
import { MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE } from "./mediaLibraryOrangeFolderIcon";

const folderChipButtonClass =
  "inline-flex max-w-full min-w-0 shrink-0 flex-row items-center gap-1.5 rounded-md border border-white/20 bg-white/[0.08] px-1.5 py-0.5 text-left text-xs font-medium text-zinc-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-[background-color,border-color] hover:border-white/30 hover:bg-white/[0.14]";
const labelClass = "min-w-0 max-w-[14rem] truncate text-left text-zinc-100";

const COL_GAP = 8;  // gap-x-2
const ROW_GAP = 4;  // gap-y-1
const FOLDER_ROW_HEIGHT = 28;
const INITIAL_TILE_ROW_HEIGHT = 80; // fallback before first real measurement

type UpRow = { type: "up"; label: string };
type FolderRow = { type: "folder"; folder: MediaFolder };
type TilesRow = { type: "tiles"; items: MediaType[]; startIndex: number };
type VirtualRow = UpRow | FolderRow | TilesRow;

export type VirtualMediaGridHandle = {
  scrollToMediaId: (id: string) => void;
};

export type VirtualMediaGridProps = {
  scrollRef: React.RefObject<HTMLElement | null>;
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
};

export const VirtualMediaGrid = forwardRef<VirtualMediaGridHandle, VirtualMediaGridProps>(
  function VirtualMediaGrid(
    {
      scrollRef,
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
    },
    ref,
  ) {
    // Start with a fallback height. The first time a tile row renders and is
    // measured, we update this to the real height and call virtualizer.measure()
    // to flush the stale estimates. This avoids relying on a ResizeObserver to
    // compute containerWidth (which fails inside Radix dialog portals).
    const [tileRowHeight, setTileRowHeight] = useState(INITIAL_TILE_ROW_HEIGHT);
    const tileRowHeightRef = useRef(tileRowHeight);
    tileRowHeightRef.current = tileRowHeight;
    const shouldSyncTileRowHeightRef = useRef(true);

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

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: (index) =>
        rowsRef.current[index]?.type === "tiles" ? tileRowHeightRef.current : FOLDER_ROW_HEIGHT,
      overscan: 3,
      paddingStart: 16,
      paddingEnd: 16,
      gap: ROW_GAP,
      // Non-zero initial viewport so items render before the scroll element is measured.
      initialRect: { width: 0, height: 600 },
    });

    const virtualizerRef = useRef(virtualizer);
    virtualizerRef.current = virtualizer;

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
      }
    }, [cols]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToMediaId(id: string) {
          const rowIndex = rowsRef.current.findIndex(
            (r) => r.type === "tiles" && r.items.some((item) => item.id === id),
          );
          if (rowIndex === -1) return;
          virtualizerRef.current.scrollToIndex(rowIndex, { align: "auto" });
          requestAnimationFrame(() => {
            scrollRef.current
              ?.querySelector(`[data-media-id="${id}"]`)
              ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          });
        },
      }),
      [scrollRef],
    );

    return (
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={(el) => {
                virtualizer.measureElement(el);
                // Update the tile height estimate from the first real measurement.
                if (el && row.type === "tiles" && shouldSyncTileRowHeightRef.current) {
                  const h = el.getBoundingClientRect().height;
                  if (h > 0) {
                    shouldSyncTileRowHeightRef.current = false;
                    if (Math.abs(h - tileRowHeightRef.current) > 1) {
                      setTileRowHeight(h);
                    }
                  }
                }
              }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.type === "up" && (
                <div className="flex items-center gap-2 px-4 py-0.5">
                  <Button
                    variant="none"
                    padding="p-0"
                    className={folderChipButtonClass}
                    onClick={onGoUp}
                    title="Up one level"
                  >
                    <ArrowUp className="h-3.5 w-3.5 shrink-0 text-zinc-200" aria-hidden />
                    <span className={labelClass}>Up</span>
                  </Button>
                  {row.label && <p className="text-xs text-zinc-200">{row.label}</p>}
                </div>
              )}
              {row.type === "folder" && (
                <div className="flex items-center px-4 py-0.5">
                  <Button
                    variant="none"
                    padding="p-0"
                    className={folderChipButtonClass}
                    onClick={() => onOpenFolder(row.folder.id)}
                    title={row.folder.name}
                  >
                    <Folder
                      {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
                      className="h-3.5 w-3.5 shrink-0 text-orange-400"
                      aria-hidden
                    />
                    <span className={labelClass}>{row.folder.name}</span>
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
