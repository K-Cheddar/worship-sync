import type { RefObject } from "react";
import Button from "../../components/Button/Button";
import CachedMediaImage from "../../components/CachedMediaImage/CachedMediaImage";
import MediaTypeBadge from "./MediaTypeBadge";
import MediaLibraryFolderGridItems from "./MediaLibraryFolderGridItems";
import cn from "classnames";
import type { MediaFolder, MediaType } from "../../types";

const sizeMap: Map<number, string> = new Map([
  [7, "grid-cols-7"],
  [6, "grid-cols-6"],
  [5, "grid-cols-5"],
  [4, "grid-cols-4"],
  [3, "grid-cols-3"],
  [2, "grid-cols-2"],
]);

export type MediaLibraryGridProps = {
  isPanelVariant: boolean;
  isMediaExpanded: boolean;
  isMediaLoading: boolean;
  mediaItemsPerRow: number;
  mediaListRef: RefObject<HTMLUListElement | null>;
  filteredList: MediaType[];
  showAll: boolean;
  showNamesInPanelGrid: boolean;
  searchTerm: string;
  childFolders: MediaFolder[];
  canGoUp: boolean;
  onGoUp: () => void;
  onOpenFolder: (id: string) => void;
  selectedMedia: MediaType;
  selectedMediaIds: Set<string>;
  onMediaTileClick: (e: React.MouseEvent, mediaItem: MediaType, index: number) => void;
};

export default function MediaLibraryGrid({
  isPanelVariant,
  isMediaExpanded,
  isMediaLoading,
  mediaItemsPerRow,
  mediaListRef,
  filteredList,
  showAll,
  showNamesInPanelGrid,
  searchTerm,
  childFolders,
  canGoUp,
  onGoUp,
  onOpenFolder,
  selectedMedia,
  selectedMediaIds,
  onMediaTileClick,
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
      {!isMediaLoading &&
        isMediaExpanded &&
        (filteredList.length > 0 || !showAll) && (
          <ul
            ref={mediaListRef}
            className={cn(
              "scrollbar-variable grid content-start items-start overflow-y-auto p-4 bg-black/30 mx-2 gap-x-2 gap-y-1 z-10 rounded-b-md min-h-0",
              isPanelVariant && "flex-1",
              sizeMap.get(mediaItemsPerRow),
            )}
            style={{
              gridAutoRows: "auto",
            }}
          >
            <MediaLibraryFolderGridItems
              active={!showAll}
              childFolders={childFolders}
              canGoUp={canGoUp}
              onGoUp={onGoUp}
              onOpenFolder={onOpenFolder}
            />
            {filteredList.map((mediaItem, index) => {
              const { id, thumbnail, name, type } = mediaItem;
              const isSelected = id === selectedMedia.id;
              const isMultiSelected = selectedMediaIds.has(id);
              const shownName = name.includes("/")
                ? name.split("/").slice(1).join("/")
                : name;

              return (
                <li key={id}>
                  <Button
                    variant="none"
                    padding="p-0"
                    className={cn(
                      "flex h-auto w-full flex-col items-center justify-center border-2",
                      isMultiSelected
                        ? "border-cyan-400 bg-cyan-400/10"
                        : isSelected
                          ? "border-cyan-400"
                          : "border-gray-500 hover:border-gray-300",
                    )}
                    onClick={(e) => {
                      onMediaTileClick(e, mediaItem, index);
                    }}
                    onContextMenu={(e) => {
                      if (!isMultiSelected && !isSelected) {
                        onMediaTileClick(e, mediaItem, index);
                      }
                    }}
                  >
                    <div
                      className={cn(
                        "relative flex aspect-video w-full items-center justify-center overflow-hidden",
                        isMediaExpanded && "border-b border-gray-500",
                      )}
                    >
                      <CachedMediaImage
                        className="max-w-full max-h-full"
                        alt={id}
                        src={thumbnail}
                        loading="lazy"
                      />
                      <MediaTypeBadge type={type} />
                    </div>

                    {isMediaExpanded && name && showNamesInPanelGrid && (
                      <div className="w-full px-1 py-1 text-center">
                        <p
                          className="text-sm text-gray-300 truncate"
                          title={name}
                        >
                          {shownName}
                        </p>
                      </div>
                    )}
                  </Button>
                </li>
              );
            })}
            {!showAll && searchTerm && filteredList.length === 0 && (
              <li className="col-span-full py-1">
                <p className="text-sm text-gray-400">
                  No media found matching &quot;{searchTerm}&quot;
                </p>
              </li>
            )}
          </ul>
        )}
      {!isMediaLoading &&
        isMediaExpanded &&
        showAll &&
        !searchTerm &&
        filteredList.length === 0 && (
          <div
            className={cn(
              "text-center py-8 bg-black/30 mx-2 px-2 rounded-b-md",
              isPanelVariant && "flex-1 min-h-0",
            )}
          >
            <p className="text-gray-400">No media in this view</p>
          </div>
        )}
      {!isMediaLoading &&
        isMediaExpanded &&
        showAll &&
        searchTerm &&
        filteredList.length === 0 && (
          <div
            className={cn(
              "text-center py-8 bg-black/30 mx-2 px-2",
              isPanelVariant && "flex-1 min-h-0",
            )}
          >
            <p className="text-gray-400">
              No media found matching "{searchTerm}"
            </p>
          </div>
        )}
    </>
  );
}
