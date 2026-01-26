import { useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
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
  Minus,
  Video,
  Maximize,
  Minimize,
  Plus,
} from "lucide-react";
import { useDispatch, useSelector, useMediaSelection } from "../../hooks";
import {
  updateAllSlideBackgrounds,
  updateSlideBackground,
} from "../../store/itemSlice";
import { MediaType } from "../../types";
import {
  setDefaultPreferences,
  setSelectedQuickLinkImage,
} from "../../store/preferencesSlice";
import cn from "classnames";
import { updateOverlayInList } from "../../store/overlaysSlice";
import { RootState } from "../../store/store";
import { updateOverlay } from "../../store/overlaySlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { MediaUploadInputRef } from "./MediaUploadInput";

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
  mediaUploadInputRef?: React.MutableRefObject<MediaUploadInputRef | null>;
  uploadProgress?: { isUploading: boolean; progress: number };
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
  mediaUploadInputRef,
  uploadProgress,
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
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter media items based on search term and type
  const filteredList = mediaList.filter((item) => {
    const matchesSearch = item.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    return matchesSearch && matchesType;
  });
  
  // Use shared selection hook for modal - independent from Media component
  const {
    selectedMedia: modalSelectedMedia,
    selectedMediaIds: modalSelectedMediaIds,
    previewMedia: modalPreviewMedia,
    setSelectedMedia: setModalSelectedMedia,
    setSelectedMediaIds: setModalSelectedMediaIds,
    setPreviewMedia: setModalPreviewMedia,
    handleMediaClick: handleModalMediaClick,
    clearSelection: clearModalSelection,
  } = useMediaSelection({
    mediaList,
    filteredList,
    enableRangeSelection: false, // Modal doesn't need range selection
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

  // Initialize modal selection state when modal opens
  useEffect(() => {
    if (isOpen) {
      setModalSelectedMedia(selectedMedia);
      setModalSelectedMediaIds(new Set(selectedMediaIds));
      setModalPreviewMedia(previewMedia);
    } else {
      // Reset when modal closes
      clearModalSelection();
      setIsExpanded(false);
    }
  }, [isOpen, selectedMedia, selectedMediaIds, previewMedia, setModalSelectedMedia, setModalSelectedMediaIds, setModalPreviewMedia, clearModalSelection]);

  // Reset expanded mode if preview media changes to video or is cleared
  useEffect(() => {
    if (!modalPreviewMedia || modalPreviewMedia.type !== "image") {
      setIsExpanded(false);
    }
  }, [modalPreviewMedia]);


  // Wrapper for delete handlers that syncs modal selection to parent
  const handleModalDeleteClick = (mediaItem: MediaType) => {
    // Sync selection to parent before deleting
    onMediaClick(
      { ctrlKey: false, metaKey: false, shiftKey: false } as React.MouseEvent,
      mediaItem,
      mediaList.findIndex((item) => item.id === mediaItem.id)
    );
    onDeleteClick(mediaItem);
  };

  const handleModalDeleteMultipleClick = () => {
    onDeleteMultipleClick();
  };

  // Generate context menu items for a media item
  const getContextMenuItems = (
    mediaItem: MediaType,
    hasMultipleSelection: boolean,
    selectedCount: number
  ) => {
    if (hasMultipleSelection) {
      return [
        {
          label: `Delete ${selectedCount} items`,
          onClick: handleModalDeleteMultipleClick,
          icon: <Trash2 className="w-4 h-4" />,
          variant: "destructive" as const,
        },
      ];
    }

    return [
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
        onClick: () => handleModalDeleteClick(mediaItem),
        icon: <Trash2 className="w-4 h-4" />,
        variant: "destructive" as const,
      },
    ];
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Media Library"
      size="full"
      contentPadding="p-0"
    >
      <div className="relative w-full overflow-hidden" style={{ height: isMobile ? "calc(100vh - 60px)" : "calc(90vh - 120px)" }}>
        {/* Expanded fullscreen view */}
        <div
          className={cn(
            "absolute inset-0 bg-gray-900 transition-all duration-300 ease-in-out",
            isExpanded && modalPreviewMedia && modalPreviewMedia.type === "image"
              ? "opacity-100 z-10"
              : "opacity-0 z-0 pointer-events-none"
          )}
        >
          {modalPreviewMedia && modalPreviewMedia.type === "image" && (
            <>
              <div className="absolute top-2 right-2 z-10 flex gap-2">
                <Button
                  variant="secondary"
                  svg={Minimize}
                  onClick={() => setIsExpanded(false)}
                  title="Exit Expanded View"
                />
                <Button
                  variant="secondary"
                  svg={Minus}
                  onClick={() => {
                    setIsExpanded(false);
                    setModalPreviewMedia(null);
                  }}
                  title="Hide Preview"
                />
              </div>
              <img
                src={modalPreviewMedia.background}
                alt={modalPreviewMedia.name}
                className="w-full h-full object-contain transition-transform duration-300 ease-in-out"
                style={{
                  transform: isExpanded ? "scale(1)" : "scale(0.95)",
                }}
              />
            </>
          )}
        </div>

        {/* Normal view */}
        <div
          className={cn(
            "flex flex-col transition-all duration-300 ease-in-out h-full",
            isExpanded && modalPreviewMedia && modalPreviewMedia.type === "image"
              ? "opacity-0 z-0 pointer-events-none"
              : "opacity-100 z-10"
          )}
        >
          <div
            className={cn(
              "px-4 py-2 bg-gray-700 relative w-full flex flex-col items-center gap-2 overflow-hidden transition-all duration-300 ease-in-out",
              modalPreviewMedia
                ? "h-[40vh] flex-1 min-h-[40vh] opacity-100"
                : "h-0 opacity-0"
            )}
          >
            {modalPreviewMedia && (
              <>
                <div className="absolute top-2 right-2 z-10 flex gap-2">
                  {modalPreviewMedia.type === "image" && (
                    <Button
                      variant="secondary"
                      svg={Maximize}
                      onClick={() => setIsExpanded(true)}
                      title="Expand to Fill Modal"
                    />
                  )}
                  <Button
                    variant="secondary"
                    svg={Minus}
                    onClick={() => setModalPreviewMedia(null)}
                    title="Hide Preview"
                  />
                </div>
                <div className="aspect-video flex items-center justify-center overflow-hidden bg-gray-800 rounded-md flex-1 max-h-full max-w-full">
                  {modalPreviewMedia.type === "video" ? (
                    <video
                      src={modalPreviewMedia.background}
                      className="max-h-full max-w-full w-full h-full object-contain"
                      controls
                      autoPlay
                    />
                  ) : (
                    <img
                      src={modalPreviewMedia.background}
                      alt={modalPreviewMedia.name}
                      className="max-w-full max-h-full w-full h-full object-contain"
                    />
                  )}
                </div>
                <p className="text-sm text-gray-300 mt-1 truncate font-medium max-w-full">
                  {modalPreviewMedia.name}
                </p>
              </>
            )}
          </div>

          {/* Zoom and Filter row */}
          <div className="px-4 py-2 bg-gray-900 flex items-center gap-2 border-b border-gray-700 relative">
            <div className="flex gap-2 items-center">
              <Button
                variant="tertiary"
                svg={ZoomOut}
                onClick={() => setModalZoomLevel((prev) => Math.max(0, prev - 1))}
                title="Zoom Out (More Items)"
              />
              <Button
                variant="tertiary"
                svg={ZoomIn}
                onClick={() => setModalZoomLevel((prev) => prev + 1)}
                title="Zoom In (Fewer Items)"
              />
            </div>
            <div className="flex gap-1 items-center border border-gray-600 rounded-md absolute left-1/2 -translate-x-1/2">
              <Button
                variant={typeFilter === "all" ? "secondary" : "tertiary"}
                onClick={(e) => {
                  e.stopPropagation();
                  setTypeFilter("all");
                }}
                className="rounded-r-none"
              >
                All
              </Button>
              <Button
                variant={typeFilter === "image" ? "secondary" : "tertiary"}
                svg={Image}
                onClick={(e) => {
                  e.stopPropagation();
                  setTypeFilter("image");
                }}
                className="rounded-none border-x border-gray-600"
              >
                <span className="max-md:hidden">Images</span>
              </Button>
              <Button
                variant={typeFilter === "video" ? "secondary" : "tertiary"}
                svg={Video}
                onClick={(e) => {
                  e.stopPropagation();
                  setTypeFilter("video");
                }}
                className="rounded-l-none"
              >
                <span className="max-md:hidden">Videos</span>
              </Button>
            </div>
            {mediaUploadInputRef && (
              <div className="ml-auto">
                <Button
                  variant="tertiary"
                  svg={Plus}
                  onClick={() => mediaUploadInputRef.current?.openModal()}
                  title={uploadProgress?.isUploading ? `Uploading... ${Math.round(uploadProgress.progress)}%` : "Add Media"}
                  disabled={uploadProgress?.isUploading}
                >
                  {uploadProgress?.isUploading ? `${Math.round(uploadProgress.progress)}%` : ""}
                </Button>
              </div>
            )}
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
              const isSelected = id === modalSelectedMedia.id;
              const isMultiSelected = modalSelectedMediaIds.has(id);
              const hasMultipleSelection = modalSelectedMediaIds.size > 1;
              const shownName = name.includes("/")
                ? name.split("/").slice(1).join("/")
                : name;

              const contextMenuItems = getContextMenuItems(
                mediaItem,
                hasMultipleSelection,
                modalSelectedMediaIds.size
              );

                return (
                  <li key={id}>
                    <ContextMenu
                      menuItems={contextMenuItems}
                      header={
                        hasMultipleSelection
                          ? {
                              title: `${modalSelectedMediaIds.size} items selected`,
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
                        handleModalMediaClick(
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
                        handleModalMediaClick(e, mediaItem, index);
                      }}
                      onContextMenu={(e) => {
                        if (!isMultiSelected && !isSelected) {
                          handleModalMediaClick(e, mediaItem, index);
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
      </div>
    </Modal>
  );
};

export default MediaModal;
