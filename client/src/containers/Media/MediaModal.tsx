import { useEffect, useRef, useState } from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import ContextMenu from "../../components/ContextMenu/ContextMenu";
import Modal from "../../components/Modal/Modal";
import Toggle from "../../components/Toggle/Toggle";
import {
  Trash2,
  ZoomIn,
  ZoomOut,
  Image,
  Images,
  Eye,
  X,
  Video,
} from "lucide-react";
import { useDispatch, useSelector } from "../../hooks";
import {
  updateAllSlideBackgrounds,
  updateSlideBackground,
} from "../../store/itemSlice";
import { MediaType } from "../../types";
import {
  setDefaultPreferences,
  setSelectedQuickLinkImage,
} from "../../store/preferencesSlice";
import { useLocation } from "react-router-dom";
import cn from "classnames";
import { updateOverlayInList } from "../../store/overlaysSlice";
import { RootState } from "../../store/store";
import { updateOverlay } from "../../store/overlaySlice";
import { useContext } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";

const sizeMap: Map<number, string> = new Map([
  [7, "grid-cols-7"],
  [6, "grid-cols-6"],
  [5, "grid-cols-5"],
  [4, "grid-cols-4"],
  [3, "grid-cols-3"],
  [2, "grid-cols-2"],
]);

type MediaModalProps = {
  isOpen: boolean;
  onClose: () => void;
  mediaList: MediaType[];
  selectedMedia: MediaType;
  selectedMediaIds: Set<string>;
  previewMedia: MediaType | null;
  searchTerm: string;
  showName: boolean;
  onMediaClick: (
    e: React.MouseEvent,
    mediaItem: MediaType,
    index: number
  ) => void;
  onSearchChange: (value: string) => void;
  onShowNameToggle: () => void;
  onDeleteClick: (mediaItem: MediaType) => void;
  onDeleteMultipleClick: () => void;
  onPreviewChange: (media: MediaType | null) => void;
};

const MediaModal = ({
  isOpen,
  onClose,
  mediaList,
  selectedMedia,
  selectedMediaIds,
  previewMedia,
  searchTerm,
  showName,
  onMediaClick,
  onSearchChange,
  onShowNameToggle,
  onDeleteClick,
  onDeleteMultipleClick,
  onPreviewChange,
}: MediaModalProps) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { db, isMobile } = useContext(ControllerInfoContext) || {};

  const { isLoading } = useSelector(
    (state: RootState) => state.undoable.present.item
  );
  const { selectedOverlay } = useSelector(
    (state: RootState) => state.undoable.present.overlay
  );
  const { selectedPreference, selectedQuickLink } = useSelector(
    (state: RootState) => state.undoable.present.preferences
  );

  const [modalZoomLevel, setModalZoomLevel] = useState(0);
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">("all");
  const modalGridRef = useRef<HTMLUListElement>(null);
  const [calculatedGridCols, setCalculatedGridCols] = useState(8);

  // Filter media items based on search term and type
  const filteredList = mediaList.filter((item) => {
    const matchesSearch = item.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    return matchesSearch && matchesType;
  });

  // Calculate grid columns based on available space
  const calculateGridColumns = (containerWidth: number) => {
    const minItemsPerRow = 8;
    const maxItemWidth = 150;
    const calculatedItems = Math.floor(containerWidth / maxItemWidth);
    return Math.max(minItemsPerRow, calculatedItems);
  };

  useEffect(() => {
    if (isOpen && modalGridRef.current) {
      const updateGridCols = () => {
        if (modalGridRef.current) {
          const width = modalGridRef.current.offsetWidth;
          const baseCols = calculateGridColumns(width);
          // Zoom out increases items per row, zoom in decreases
          setCalculatedGridCols(Math.max(2, baseCols - modalZoomLevel));
        }
      };
      updateGridCols();
      const resizeObserver = new ResizeObserver(updateGridCols);
      resizeObserver.observe(modalGridRef.current);
      window.addEventListener("resize", updateGridCols);
      return () => {
        window.removeEventListener("resize", updateGridCols);
        resizeObserver.disconnect();
      };
    }
  }, [isOpen, modalZoomLevel]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Media Library"
      size="full"
      contentPadding="p-0"
    >
      <div className={cn("flex flex-col", isMobile ? "h-[calc(99vh-120px)]" : "h-[calc(90vh-120px)]")}>
        {/* Preview area in fullscreen */}
        {previewMedia && (
          <div className="px-4 py-2 bg-gray-900 border-b border-gray-700 relative">
            <Button
              variant="tertiary"
              svg={X}
              onClick={() => onPreviewChange(null)}
              className="absolute top-2 right-2 z-10"
              title="Hide Preview"
            />
            <div className="aspect-video flex items-center justify-center w-full overflow-hidden bg-gray-800 rounded-md">
              {previewMedia.type === "video" ? (
                <video
                  src={previewMedia.background}
                  className="w-full h-full object-cover"
                  controls
                  autoPlay
                />
              ) : (
                <img
                  src={previewMedia.background}
                  alt={previewMedia.name}
                  className="max-w-full max-h-full object-contain"
                />
              )}
            </div>
            <p className="text-sm text-gray-400 mt-1 truncate font-medium">
              {previewMedia.name}
            </p>
          </div>
        )}

        {/* Zoom and Filter row */}
        <div className="px-4 py-2 bg-gray-900 flex items-center gap-2 border-b border-gray-700">
          <div className="flex gap-2 items-center">
            <Button
              variant="tertiary"
              svg={ZoomOut}
              onClick={() => setModalZoomLevel((prev) => prev + 1)}
              title="Zoom Out (More Items)"
            />
            <Button
              variant="tertiary"
              svg={ZoomIn}
              onClick={() => setModalZoomLevel((prev) => Math.max(0, prev - 1))}
              title="Zoom In (Fewer Items)"
            />
          </div>
          <div className="flex gap-1 items-center border border-gray-600 rounded-md ml-auto">
            <Button
              variant={typeFilter === "all" ? "secondary" : "tertiary"}
              onClick={() => setTypeFilter("all")}
              className="rounded-r-none"
            >
              All
            </Button>
            <Button
              variant={typeFilter === "image" ? "secondary" : "tertiary"}
              svg={Image}
              onClick={() => setTypeFilter("image")}
              className="rounded-none border-x border-gray-600"
            >
              Images
            </Button>
            <Button
              variant={typeFilter === "video" ? "secondary" : "tertiary"}
              svg={Video}
              onClick={() => setTypeFilter("video")}
              className="rounded-l-none"
            >
              Videos
            </Button>
          </div>
        </div>

        {/* Search and Toggle row */}
        <div className="px-4 py-2 bg-gray-900 flex items-center gap-2 border-b border-gray-700">
          <Input
            type="text"
            label="Search"
            value={searchTerm}
            onChange={(value) => onSearchChange(value as string)}
            placeholder="Name"
            className="flex gap-4 items-center flex-1"
            inputWidth="w-full"
            inputTextSize="text-sm"
            svg={searchTerm ? X : undefined}
            svgAction={() => onSearchChange("")}
          />
          <Toggle
            icon={Eye}
            value={showName}
            onChange={onShowNameToggle}
          />
        </div>

        {/* Media grid */}
        {filteredList.length !== 0 ? (
          <ul
            ref={modalGridRef}
            className={cn(
              "scrollbar-variable grid overflow-y-auto p-4 gap-x-2 gap-y-1",
              sizeMap.get(calculatedGridCols) || `grid-cols-${calculatedGridCols}`
            )}
            style={{
              gridTemplateColumns: `repeat(${calculatedGridCols}, minmax(0, 1fr))`,
              gridAutoRows: "auto",
            }}
          >
            {filteredList.map((mediaItem, index) => {
              const { id, thumbnail, name, type } = mediaItem;
              const isSelected = id === selectedMedia.id;
              const isMultiSelected = selectedMediaIds.has(id);
              const hasMultipleSelection = selectedMediaIds.size > 1;
              const shownName = name.includes("/")
                ? name.split("/").slice(1).join("/")
                : name;

              const contextMenuItems = hasMultipleSelection
                ? [
                    {
                      label: `Delete ${selectedMediaIds.size} items`,
                      onClick: onDeleteMultipleClick,
                      icon: <Trash2 className="w-4 h-4" />,
                      variant: "destructive" as const,
                    },
                  ]
                : [
                    ...(location.pathname.includes("item")
                      ? [
                          {
                            label: "Set All Slides",
                            onClick: () => {
                              if (mediaItem.background && db) {
                                dispatch(
                                  updateAllSlideBackgrounds({
                                    background: mediaItem.background,
                                    mediaInfo: mediaItem,
                                  })
                                );
                              }
                            },
                            icon: <Images className="w-4 h-4" />,
                            disabled: isLoading || !mediaItem.background,
                          },
                          {
                            label: "Set Selected Slide",
                            onClick: () => {
                              if (mediaItem.background && db) {
                                dispatch(
                                  updateSlideBackground({
                                    background: mediaItem.background,
                                    mediaInfo: mediaItem,
                                  })
                                );
                              }
                            },
                            icon: <Image className="w-4 h-4" />,
                            disabled: isLoading || !mediaItem.background,
                          },
                        ]
                      : []),
                    ...(location.pathname.includes("overlays") &&
                    selectedOverlay?.type === "image"
                      ? [
                          {
                            label: "Set Image Overlay",
                            onClick: () => {
                              if (mediaItem.background && db) {
                                dispatch(
                                  updateOverlay({
                                    imageUrl: mediaItem.background,
                                    id: selectedOverlay?.id,
                                  })
                                );
                                dispatch(
                                  updateOverlayInList({
                                    imageUrl: mediaItem.background,
                                    id: selectedOverlay?.id,
                                  })
                                );
                              }
                            },
                            icon: <Image className="w-4 h-4" />,
                            disabled: !mediaItem.background || !selectedOverlay,
                          },
                        ]
                      : []),
                    ...(location.pathname.includes("preferences") &&
                    !location.pathname.includes("quick-links") &&
                    !location.pathname.includes("monitor-settings") &&
                    selectedPreference
                      ? [
                          {
                            label: "Set Background",
                            onClick: () => {
                              dispatch(
                                setDefaultPreferences({
                                  [selectedPreference]: {
                                    background: mediaItem.background,
                                    mediaInfo: mediaItem,
                                  },
                                })
                              );
                            },
                            icon: <Image className="w-4 h-4" />,
                            disabled: !selectedPreference || !mediaItem.background,
                          },
                        ]
                      : []),
                    ...(location.pathname.includes("quick-links") &&
                    selectedQuickLink?.linkType === "media"
                      ? [
                          {
                            label: "Set Quick Link Background",
                            onClick: () => {
                              dispatch(setSelectedQuickLinkImage(mediaItem));
                            },
                            icon: <Image className="w-4 h-4" />,
                            disabled:
                              !selectedQuickLink ||
                              selectedQuickLink?.linkType !== "media",
                          },
                        ]
                      : []),
                    {
                      label: "Delete",
                      onClick: () => onDeleteClick(mediaItem),
                      icon: <Trash2 className="w-4 h-4" />,
                      variant: "destructive" as const,
                    },
                  ];

              return (
                <li key={id}>
                  <ContextMenu
                    menuItems={contextMenuItems}
                    header={
                      hasMultipleSelection
                        ? {
                            title: `${selectedMediaIds.size} items selected`,
                            subtitle: "Multiple selection",
                          }
                        : {
                            title: shownName,
                            subtitle:
                              type.charAt(0).toUpperCase() + type.slice(1),
                          }
                    }
                    onOpen={() => {
                      if (!isMultiSelected && !hasMultipleSelection) {
                        onMediaClick(
                          {
                            ctrlKey: false,
                            metaKey: false,
                            shiftKey: false,
                          } as React.MouseEvent,
                          mediaItem,
                          index
                        );
                      }
                    }}
                  >
                    <Button
                      variant="none"
                      padding="p-0"
                      className={cn(
                        "w-full h-full justify-center flex flex-col items-center border-2",
                        isMultiSelected
                          ? "border-cyan-400 bg-cyan-400/10"
                          : isSelected
                          ? "border-cyan-400"
                          : "border-gray-500 hover:border-gray-300"
                      )}
                      onClick={(e) => {
                        onMediaClick(e, mediaItem, index);
                      }}
                      onContextMenu={(e) => {
                        if (!isMultiSelected && !isSelected) {
                          onMediaClick(e, mediaItem, index);
                        }
                      }}
                    >
                      <div className="aspect-video flex items-center justify-center w-full flex-1 overflow-hidden border-b border-gray-500">
                        <img
                          className="max-w-full max-h-full"
                          alt={id}
                          src={thumbnail}
                          loading="lazy"
                        />
                      </div>

                      {name && showName && (
                        <div className="w-full px-1 py-1.5 text-center">
                          <p
                            className="text-sm font-medium text-gray-300 truncate"
                            title={name}
                          >
                            {shownName}
                          </p>
                        </div>
                      )}
                    </Button>
                  </ContextMenu>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-center py-8 px-2 flex-1 flex items-center justify-center">
            <p className="text-gray-400">
              {searchTerm
                ? `No media found matching "${searchTerm}"`
                : "No media available"}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default MediaModal;
