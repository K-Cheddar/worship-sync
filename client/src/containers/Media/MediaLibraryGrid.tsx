import { useCallback, useState, type HTMLAttributes, type RefObject } from "react";
import { VirtualMediaGrid, type VirtualMediaGridHandle } from "./VirtualMediaGrid";
import cn from "classnames";
import type { MediaFolder, MediaType } from "../../types";

export type MediaLibraryGridProps = {
  isPanelVariant: boolean;
  isMediaExpanded: boolean;
  isMediaLoading: boolean;
  hasMediaLoadError: boolean;
  mediaItemsPerRow: number;
  mediaListRef: RefObject<HTMLElement | null>;
  mediaGridRef: RefObject<VirtualMediaGridHandle | null>;
  filteredList: MediaType[];
  showAll: boolean;
  showNamesInPanelGrid: boolean;
  searchTerm: string;
  childFolders: MediaFolder[];
  canGoUp: boolean;
  currentFolderName?: string;
  onGoUp: () => void;
  onOpenFolder: (id: string) => void;
  selectedMedia: MediaType;
  selectedMediaIds: Set<string>;
  mediaMultiSelectMode: boolean;
  onMediaTileClick: (e: React.MouseEvent, mediaItem: MediaType, index: number) => void;
  onEnterMediaMultiSelectMode: (
    mediaItem: MediaType,
    index: number,
    options?: { skipNextClick?: boolean },
  ) => void;
  mediaDragEnabled?: boolean;
  orderedSelectedMediaIds?: string[];
  nativeFileDropHandlers?: Pick<
    HTMLAttributes<HTMLDivElement>,
    "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"
  >;
  isFileDragOver?: boolean;
};

export default function MediaLibraryGrid({
  isPanelVariant,
  isMediaExpanded,
  isMediaLoading,
  hasMediaLoadError,
  mediaItemsPerRow,
  mediaListRef,
  mediaGridRef,
  filteredList,
  showAll,
  showNamesInPanelGrid,
  searchTerm,
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
  mediaDragEnabled = false,
  orderedSelectedMediaIds = [],
  nativeFileDropHandlers,
  isFileDragOver = false,
}: MediaLibraryGridProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const setMediaListElement = useCallback(
    (element: HTMLDivElement | null) => {
      mediaListRef.current = element;
      setScrollElement(element);
    },
    [mediaListRef],
  );
  return (
    <div
      {...nativeFileDropHandlers}
      className={cn(
        isPanelVariant
          ? "relative flex h-full min-h-0 flex-1 flex-col"
          : "contents",
      )}
    >
      {isFileDragOver && isPanelVariant ? (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-b-md bg-blue-950/75 text-lg font-semibold text-blue-100">
          Drop files to add media
        </div>
      ) : null}
      {isMediaLoading && isMediaExpanded && (
        <h3
          className={cn(
            "text-center font-lg pt-4 bg-black/30 mx-2",
            isPanelVariant ? "flex-1 min-h-0" : "h-full",
          )}
        >
          Loading media...
        </h3>
      )}
      {hasMediaLoadError && isMediaExpanded && (
        <div
          role="alert"
          className={cn(
            "mx-2 bg-black/30 px-4 py-8 text-center",
            isPanelVariant ? "flex-1 min-h-0" : "h-full",
          )}
        >
          <p className="font-medium text-gray-200">Media is unavailable.</p>
          <p className="mt-1 text-sm text-gray-400">
            Reload the page before making media changes.
          </p>
        </div>
      )}
      {!isMediaLoading && !hasMediaLoadError && isMediaExpanded && (filteredList.length > 0 || !showAll) && (
        <div
          ref={setMediaListElement}
          className={cn(
            "scrollbar-variable relative overflow-y-auto bg-black/30 mx-2 z-10 rounded-b-md min-h-0",
            isPanelVariant && "h-full flex-1",
          )}
        >
          {isFileDragOver && !isPanelVariant ? (
            <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-b-md bg-blue-950/75 text-lg font-semibold text-blue-100">
              Drop files to add media
            </div>
          ) : null}
          <VirtualMediaGrid
            ref={mediaGridRef}
            scrollRef={mediaListRef}
            scrollElement={scrollElement}
            mediaItems={filteredList}
            cols={mediaItemsPerRow}
            showFolders={!showAll}
            childFolders={childFolders}
            canGoUp={canGoUp}
            currentFolderName={currentFolderName}
            onGoUp={onGoUp}
            onOpenFolder={onOpenFolder}
            selectedMedia={selectedMedia}
            selectedMediaIds={selectedMediaIds}
            mediaMultiSelectMode={mediaMultiSelectMode}
            onMediaTileClick={onMediaTileClick}
            onEnterMediaMultiSelectMode={onEnterMediaMultiSelectMode}
            showBottomName={isMediaExpanded && showNamesInPanelGrid}
            mediaDragEnabled={mediaDragEnabled}
            orderedSelectedMediaIds={orderedSelectedMediaIds}
          />
          {!showAll && searchTerm && filteredList.length === 0 && (
            <p className="px-4 py-1 text-sm text-gray-400">
              No media found matching &quot;{searchTerm}&quot;
            </p>
          )}
        </div>
      )}
      {!isMediaLoading && !hasMediaLoadError && isMediaExpanded && showAll && !searchTerm && filteredList.length === 0 && (
        <div
          className={cn(
            "relative text-center py-8 bg-black/30 mx-2 px-2 rounded-b-md",
            isPanelVariant && "flex-1 min-h-0",
          )}
        >
          <p className="text-gray-400">No media in this view</p>
        </div>
      )}
      {!isMediaLoading && !hasMediaLoadError && isMediaExpanded && showAll && searchTerm && filteredList.length === 0 && (
        <div
          className={cn(
            "relative text-center py-8 bg-black/30 mx-2 px-2",
            isPanelVariant && "flex-1 min-h-0",
          )}
        >
          <p className="text-gray-400">No media found matching &quot;{searchTerm}&quot;</p>
        </div>
      )}
    </div>
  );
}
