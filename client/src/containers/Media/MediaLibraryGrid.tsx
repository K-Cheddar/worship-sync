import type { RefObject } from "react";
import { VirtualMediaGrid, type VirtualMediaGridHandle } from "./VirtualMediaGrid";
import cn from "classnames";
import type { MediaFolder, MediaType } from "../../types";

export type MediaLibraryGridProps = {
  isPanelVariant: boolean;
  isMediaExpanded: boolean;
  isMediaLoading: boolean;
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
};

export default function MediaLibraryGrid({
  isPanelVariant,
  isMediaExpanded,
  isMediaLoading,
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
}: MediaLibraryGridProps) {
  return (
    <>
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
      {!isMediaLoading && isMediaExpanded && (filteredList.length > 0 || !showAll) && (
        <div
          ref={mediaListRef as RefObject<HTMLDivElement>}
          className={cn(
            "scrollbar-variable overflow-y-auto bg-black/30 mx-2 z-10 rounded-b-md min-h-0",
            isPanelVariant && "flex-1",
          )}
        >
          <VirtualMediaGrid
            ref={mediaGridRef}
            scrollRef={mediaListRef}
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
          />
          {!showAll && searchTerm && filteredList.length === 0 && (
            <p className="px-4 py-1 text-sm text-gray-400">
              No media found matching &quot;{searchTerm}&quot;
            </p>
          )}
        </div>
      )}
      {!isMediaLoading && isMediaExpanded && showAll && !searchTerm && filteredList.length === 0 && (
        <div
          className={cn(
            "text-center py-8 bg-black/30 mx-2 px-2 rounded-b-md",
            isPanelVariant && "flex-1 min-h-0",
          )}
        >
          <p className="text-gray-400">No media in this view</p>
        </div>
      )}
      {!isMediaLoading && isMediaExpanded && showAll && searchTerm && filteredList.length === 0 && (
        <div
          className={cn(
            "text-center py-8 bg-black/30 mx-2 px-2",
            isPanelVariant && "flex-1 min-h-0",
          )}
        >
          <p className="text-gray-400">No media found matching &quot;{searchTerm}&quot;</p>
        </div>
      )}
    </>
  );
}
