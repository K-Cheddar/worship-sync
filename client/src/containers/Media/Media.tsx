import { useCallback, useContext, useEffect, useRef, useState } from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import DeleteModal from "../../components/Modal/DeleteModal";
import ContextMenu from "../../components/ContextMenu/ContextMenu";
import {
  Trash2,
  Image,
  Images,
  Eye,
  ChevronDown,
  ChevronUp,
  Maximize,
  Plus,
  X,
} from "lucide-react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector, useMediaSelection } from "../../hooks";
import {
  updateAllSlideBackgrounds,
  updateSlideBackground,
} from "../../store/itemSlice";
import { DBMedia, MediaType } from "../../types";
import {
  initiateMediaList,
  updateMediaList,
  updateMediaListFromRemote,
  addItemToMediaList,
} from "../../store/mediaSlice";
import { retrieveImages } from "../../utils/itemUtil";
import { mediaInfoType } from "./cloudinaryTypes";
import MediaUploadInput, { MediaUploadInputRef } from "./MediaUploadInput";
import generateRandomId from "../../utils/generateRandomId";
import {
  deleteFromCloudinary,
  extractPublicId,
} from "../../utils/cloudinaryUtils";
import { getApiBasePath } from "../../utils/environment";
import {
  setDefaultPreferences,
  setIsMediaExpanded,
  setMediaItems,
  setSelectedQuickLinkImage,
} from "../../store/preferencesSlice";
import { useLocation } from "react-router-dom";
import cn from "classnames";
import { updateOverlayInList } from "../../store/overlaysSlice";
import { RootState } from "../../store/store";
import { fill } from "@cloudinary/url-gen/actions/resize";
import Toggle from "../../components/Toggle/Toggle";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { updateOverlay } from "../../store/overlaySlice";
import { ActionCreators } from "redux-undo";
import MediaModal from "./MediaModal";


const sizeMap: Map<number, string> = new Map([
  [7, "grid-cols-7"],
  [6, "grid-cols-6"],
  [5, "grid-cols-5"],
  [4, "grid-cols-4"],
  [3, "grid-cols-3"],
  [2, "grid-cols-2"],
]);

const Media = () => {
  const dispatch = useDispatch();
  const location = useLocation();

  const { list } = useSelector((state: RootState) => state.media);
  const { isLoading } = useSelector(
    (state: RootState) => state.undoable.present.item
  );
  const { selectedOverlay } = useSelector(
    (state: RootState) => state.undoable.present.overlay
  );

  const {
    isMediaExpanded,
    mediaItemsPerRow,
    selectedPreference,
    selectedQuickLink,
  } = useSelector((state: RootState) => state.undoable.present.preferences);

  const [isMediaLoading, setIsMediaLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [mediaToDelete, setMediaToDelete] = useState<MediaType | null>(null);
  const [isDeletingMultiple, setIsDeletingMultiple] = useState(false);
  const [showName, setShowName] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ isUploading: boolean; progress: number }>({ isUploading: false, progress: 0 });
  const mediaUploadInputRef = useRef<MediaUploadInputRef>(null);
  const mediaListRef = useRef<HTMLUListElement>(null);

  // Filter media items based on search term
  const filteredList = list.filter((item) =>
    item.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Use shared selection hook
  const {
    selectedMedia,
    selectedMediaIds,
    previewMedia,
    setPreviewMedia,
    handleMediaClick,
    clearSelection,
  } = useMediaSelection({
    mediaList: list,
    filteredList,
    enableRangeSelection: true,
  });

  const { db, cloud, isMobile, updater } =
    useContext(ControllerInfoContext) || {};



  useEffect(() => {
    if (isMobile) {
      dispatch(setMediaItems(3));
    } else {
      dispatch(setMediaItems(5));
    }
  }, [isMobile, dispatch]);

  useEffect(() => {
    const getAllItems = async () => {
      if (!db || !cloud) return;
      const response: DBMedia | undefined = await db?.get("images");
      const backgrounds = response?.backgrounds || [];
      const images = retrieveImages({ backgrounds });
      dispatch(initiateMediaList(images));
      setIsMediaLoading(false);
    };
    getAllItems();
  }, [dispatch, db, cloud]);

  // Poll upload status to show progress on Add button
  useEffect(() => {
    if (!mediaUploadInputRef.current) return;

    const interval = setInterval(() => {
      const status = mediaUploadInputRef.current?.getUploadStatus();
      if (status) {
        setUploadProgress({
          isUploading: status.isUploading,
          progress: status.progress,
        });
      }
    }, 500); // Poll every 500ms

    return () => clearInterval(interval);
  }, []);

  const updateMediaListFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "images") {
            console.log("updating media list from remote");
            const update = _update as DBMedia;
            const images = retrieveImages({
              backgrounds: update.backgrounds,
            });
            dispatch(updateMediaListFromRemote(images));
          }
        }
        
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch]
  );

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updateMediaListFromExternal);

    return () => {
      updater.removeEventListener("update", updateMediaListFromExternal);
    };
  }, [updater, updateMediaListFromExternal]);

  useGlobalBroadcast(updateMediaListFromExternal);



  // Clear selection when clicking outside media items
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is outside the media list and not on a context menu or modal
      if (
        mediaListRef.current &&
        !mediaListRef.current.contains(target) &&
        !target.closest('[data-slot="dropdown-menu-content"]') &&
        !target.closest(".fixed.z-50") &&
        !target.closest('[role="dialog"]') &&
        !isFullscreen
      ) {
        clearSelection();
      }
    };

    if (selectedMediaIds.size > 0) {
      document.addEventListener("click", handleClickOutside);
      return () => {
        document.removeEventListener("click", handleClickOutside);
      };
    }
  }, [selectedMediaIds.size, isFullscreen, clearSelection]);



  const handleConfirmDelete = async () => {
    if (isDeletingMultiple) {
      // Handle multiple deletions
      await handleDeleteAll();
      setShowDeleteModal(false);
      setIsDeletingMultiple(false);
      return;
    }

    if (!db || !mediaToDelete) return;

    try {
      // Delete from source (Cloudinary or Mux)
      if (mediaToDelete.source === "cloudinary" && cloud) {
        let publicId = mediaToDelete.publicId;
        if (!publicId) {
          // Extract public_id from the background URL
          publicId = extractPublicId(mediaToDelete.background) || "";
        }

        if (publicId) {
          // Delete from Cloudinary
          const cloudinarySuccess = await deleteFromCloudinary(
            cloud,
            publicId,
            mediaToDelete.type
          );
          if (!cloudinarySuccess) {
            console.warn(
              "Failed to delete from Cloudinary, but continuing with local deletion"
            );
          }
        }
      } else if (mediaToDelete.source === "mux" && mediaToDelete.muxAssetId) {
        // Delete from Mux
        try {
          const response = await fetch(
            `${getApiBasePath()}api/mux/asset/${mediaToDelete.muxAssetId}`,
            { method: "DELETE" }
          );
          
          if (!response.ok) {
            console.warn(
              "Failed to delete from Mux, but continuing with local deletion"
            );
          }
        } catch (error) {
          console.warn("Error deleting from Mux:", error);
        }
      }

      // Remove from local list
      const updatedList = list.filter((item) => item.id !== mediaToDelete.id);
      dispatch(updateMediaList(updatedList));
      clearSelection();
      dispatch(ActionCreators.clearHistory());
    } catch (error) {
      console.error("Error deleting background:", error);
      // Still remove from local list even if deletion fails
      const updatedList = list.filter((item) => item.id !== mediaToDelete.id);
      dispatch(updateMediaList(updatedList));
      clearSelection();
    } finally {
      setShowDeleteModal(false);
      setMediaToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setMediaToDelete(null);
    setIsDeletingMultiple(false);
  };


  const handleDeleteAll = async () => {
    if (!db || selectedMediaIds.size === 0) return;

    const itemsToDelete = list.filter((item) => selectedMediaIds.has(item.id));
    
    try {
      // Delete all items from their sources
      for (const item of itemsToDelete) {
        if (item.source === "cloudinary" && cloud) {
          let publicId = item.publicId;
          if (!publicId) {
            publicId = extractPublicId(item.background) || "";
          }
          if (publicId) {
            await deleteFromCloudinary(cloud, publicId, item.type);
          }
        } else if (item.source === "mux" && item.muxAssetId) {
          try {
            await fetch(`${getApiBasePath()}api/mux/asset/${item.muxAssetId}`, {
              method: "DELETE",
            });
          } catch (error) {
            console.warn("Error deleting from Mux:", error);
          }
        }
      }

      // Remove from local list
      const updatedList = list.filter(
        (item) => !selectedMediaIds.has(item.id)
      );
      dispatch(updateMediaList(updatedList));
      clearSelection();
      dispatch(ActionCreators.clearHistory());
    } catch (error) {
      console.error("Error deleting media:", error);
      // Still remove from local list even if deletion fails
      const updatedList = list.filter(
        (item) => !selectedMediaIds.has(item.id)
      );
      dispatch(updateMediaList(updatedList));
      clearSelection();
    }
  };

  const addNewBackground = ({
    public_id,
    secure_url,
    playback_url,
    resource_type,
    created_at,
    format,
    height,
    width,
    original_filename,
    frame_rate,
    duration,
    is_audio,
  }: mediaInfoType) => {
    let placeholderImage = "";
    let thumbnailUrl = "";
    if (resource_type === "video") {
      // replace extension to get a static image:
      placeholderImage = secure_url.replace(/\.[^.]*$/, ".png");
      const smallVideo =
        cloud?.video(public_id).resize(fill().width(250)).toURL() || "";
      thumbnailUrl = smallVideo
        .replace(/\?.*$/, "") // Remove query string
        .replace(/\/([^/]+)$/, "/$1.png");
    } else {
      thumbnailUrl =
        cloud?.image(public_id).resize(fill().width(250)).toURL() || "";
    }

    const newMedia: MediaType = {
      path: "",
      createdAt: created_at,
      updatedAt: created_at,
      format,
      height,
      width,
      publicId: public_id,
      name: original_filename,
      type: resource_type,
      id: generateRandomId(),
      background: playback_url || secure_url,
      thumbnail: thumbnailUrl,
      placeholderImage,
      frameRate: frame_rate,
      duration,
      hasAudio: is_audio,
      source: "cloudinary",
    };

    dispatch(addItemToMediaList(newMedia));
  };

  const addMuxVideo = ({
    playbackId,
    assetId,
    playbackUrl,
    thumbnailUrl,
    name,
  }: {
    playbackId: string;
    assetId: string;
    playbackUrl: string;
    thumbnailUrl: string;
    name: string;
  }) => {
    const currentTime = new Date().toISOString();
    
    const newMedia: MediaType = {
      path: "",
      createdAt: currentTime,
      updatedAt: currentTime,
      format: "m3u8",
      height: 1920,
      width: 1080,
      publicId: playbackId,
      name,
      type: "video",
      id: generateRandomId(),
      background: playbackUrl,
      thumbnail: thumbnailUrl,
      placeholderImage: thumbnailUrl,
      source: "mux",
      muxPlaybackId: playbackId,
      muxAssetId: assetId,
    };

    dispatch(addItemToMediaList(newMedia));
  };



  return (
    <ErrorBoundary>
      <div
        className={`mx-2 bg-gray-900 rounded-t-md flex items-center text-sm relative z-10 transition-all  mt-2 px-2 ${
          isMediaExpanded ? " py-1" : "rounded-b-md py-0.5"
        }`}
      >
        <h2 className="font-semibold">Media</h2>
        <div className="flex-1 flex items-center justify-center">
          <Button
            variant="tertiary"
            svg={isMediaExpanded ? ChevronDown : ChevronUp}
            onClick={() => {
              dispatch(setIsMediaExpanded(!isMediaExpanded));
              if (isMediaExpanded) {
                setSearchTerm("");
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          {isMediaExpanded && (
            <Button
              variant="tertiary"
              svg={Plus}
              onClick={() => mediaUploadInputRef.current?.openModal()}
              title={uploadProgress.isUploading ? `Uploading... ${Math.round(uploadProgress.progress)}%` : "Add Media"}
              disabled={uploadProgress.isUploading}
            >
              {uploadProgress.isUploading ? `${Math.round(uploadProgress.progress)}%` : ""}
            </Button>
          )}
          <Button
            variant="tertiary"
            svg={Maximize}
            onClick={() => setIsFullscreen(true)}
            title="Fullscreen"
          />
        </div>
      </div>
      {/* Unified media upload component */}
      <MediaUploadInput
        ref={mediaUploadInputRef}
        onImageComplete={(info: mediaInfoType) => {
          addNewBackground(info);
        }}
        onVideoComplete={(muxData: {
          playbackId: string;
          assetId: string;
          playbackUrl: string;
          thumbnailUrl: string;
          name: string;
        }) => {
          addMuxVideo(muxData);
        }}
        showButton={false}
        uploadPreset="bpqu4ma5"
        cloudName="portable-media"
      />
      {!isMediaLoading && isMediaExpanded && (
        <div className="px-4 py-2 bg-gray-900 mx-2 flex items-center gap-2">
          <Input
            type="text"
            label="Search"
            value={searchTerm}
            onChange={(value) => {
              setSearchTerm(value as string);
            }}
            placeholder="Name"
            className="flex gap-4 items-center flex-1"
            inputWidth="w-full"
            inputTextSize="text-sm"
            svg={searchTerm ? X : undefined}
            svgAction={() => setSearchTerm("")}
          />
          <Toggle
            icon={Eye}
            value={showName}
            onChange={() => setShowName(!showName)}
          />
        </div>
      )}
      {isMediaLoading && isMediaExpanded && (
        <h3 className="text-center font-lg pt-4 bg-gray-800 mx-2 h-full">
          Loading media...
        </h3>
      )}
      {!isMediaLoading && isMediaExpanded && filteredList.length !== 0 && (
        <ul
          ref={mediaListRef}
          className={cn(
            "scrollbar-variable grid overflow-y-auto p-4 bg-gray-800 mx-2 gap-x-2 gap-y-1 z-10 rounded-b-md",
            sizeMap.get(mediaItemsPerRow)
          )}
          style={{
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
                    onClick: () => {
                      setIsDeletingMultiple(true);
                      setShowDeleteModal(true);
                    },
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
                          disabled: !selectedQuickLink || selectedQuickLink?.linkType !== "media",
                        },
                      ]
                    : []),
                  {
                    label: "Delete",
                    onClick: () => {
                      setMediaToDelete(mediaItem);
                      setShowDeleteModal(true);
                    },
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
                          subtitle: type.charAt(0).toUpperCase() + type.slice(1),
                        }
                  }
                  onOpen={() => {
                    // Ensure this item is selected when context menu opens
                    if (!isMultiSelected && !hasMultipleSelection) {
                      handleMediaClick(
                        { ctrlKey: false, metaKey: false, shiftKey: false } as React.MouseEvent,
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
                      handleMediaClick(e, mediaItem, index);
                    }}
                    onContextMenu={(e) => {
                      // Ensure selection happens on right-click too
                      if (!isMultiSelected && !isSelected) {
                        handleMediaClick(e, mediaItem, index);
                      }
                    }}
                  >
                    <div
                      className={cn(
                        "aspect-video flex items-center justify-center w-full flex-1 overflow-hidden",
                        isMediaExpanded && "border-b border-gray-500"
                      )}
                    >
                      <img
                        className="max-w-full max-h-full"
                        alt={id}
                        src={thumbnail}
                        loading="lazy"
                      />
                    </div>

                    {isMediaExpanded && name && showName && (
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
                </ContextMenu>
              </li>
            );
          })}
        </ul>
      )}
      {!isMediaLoading && isMediaExpanded && searchTerm && filteredList.length === 0 && (
        <div className="text-center py-8 bg-gray-800 mx-2 px-2">
          <p className="text-gray-400">
            No media found matching "{searchTerm}"
          </p>
        </div>
      )}

      <DeleteModal
        isOpen={showDeleteModal}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        itemName={
          isDeletingMultiple
            ? undefined
            : mediaToDelete?.name
        }
        title="Delete Media"
        message={
          isDeletingMultiple
            ? `Are you sure you want to delete ${selectedMediaIds.size} items`
            : "Are you sure you want to delete"
        }
        imageUrl={isDeletingMultiple ? undefined : mediaToDelete?.thumbnail}
      />

      {/* Fullscreen Modal */}
      <MediaModal
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        mediaList={list}
        selectedMedia={selectedMedia}
        selectedMediaIds={selectedMediaIds}
        previewMedia={previewMedia}
        searchTerm={searchTerm}
        showName={showName}
        onMediaClick={handleMediaClick}
        onSearchChange={(value) => setSearchTerm(value)}
        onShowNameToggle={() => setShowName(!showName)}
        onDeleteClick={(mediaItem) => {
          setMediaToDelete(mediaItem);
          setShowDeleteModal(true);
        }}
        onDeleteMultipleClick={() => {
          setIsDeletingMultiple(true);
          setShowDeleteModal(true);
        }}
        onPreviewChange={setPreviewMedia}
        mediaUploadInputRef={mediaUploadInputRef}
        uploadProgress={uploadProgress}
      />
    </ErrorBoundary>
  );
};

export default Media;
