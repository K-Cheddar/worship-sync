import { useCallback, useContext, useEffect, useState } from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import DeleteModal from "../../components/Modal/DeleteModal";
import { ReactComponent as BgAll } from "../../assets/icons/background-all.svg";
import { ReactComponent as BGOne } from "../../assets/icons/background-one.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { ReactComponent as ExpandSVG } from "../../assets/icons/expand.svg";
import { ReactComponent as CollapseSVG } from "../../assets/icons/collapse.svg";
import { ReactComponent as ZoomInSVG } from "../../assets/icons/zoom-in.svg";
import { ReactComponent as ZoomOutSVG } from "../../assets/icons/zoom-out.svg";
import { ReactComponent as ClearBackgroundSVG } from "../../assets/icons/hide-image.svg";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import {
  updateAllSlideBackgrounds,
  updateSlideBackground,
} from "../../store/itemSlice";
import "./Media.scss";
import { DBMedia, MediaType } from "../../types";
import {
  initiateMediaList,
  updateMediaList,
  updateMediaListFromRemote,
  addItemToMediaList,
} from "../../store/mediaSlice";
import { retrieveImages } from "../../utils/itemUtil";
import CloudinaryUploadWidget, {
  mediaInfoType,
} from "./CloudinaryUploadWidget";
import generateRandomId from "../../utils/generateRandomId";
import {
  deleteFromCloudinary,
  extractPublicId,
} from "../../utils/cloudinaryUtils";
import {
  decreaseMediaItems,
  increaseMediaItems,
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

const sizeMap: Map<number, string> = new Map([
  [7, "grid-cols-7"],
  [6, "grid-cols-6"],
  [5, "grid-cols-5"],
  [4, "grid-cols-4"],
  [3, "grid-cols-3"],
  [2, "grid-cols-2"],
]);

const emptyMedia: MediaType = {
  id: "",
  background: "",
  type: "image",
  path: "",
  createdAt: "",
  updatedAt: "",
  format: "",
  height: 0,
  width: 0,
  publicId: "",
  name: "",
  thumbnail: "",
  placeholderImage: "",
  frameRate: 0,
  duration: 0,
  hasAudio: false,
};

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
    tab,
    selectedQuickLink,
  } = useSelector((state: RootState) => state.undoable.present.preferences);

  const [selectedMedia, setSelectedMedia] = useState<MediaType>(emptyMedia);
  const [isMediaLoading, setIsMediaLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [mediaToDelete, setMediaToDelete] = useState<MediaType | null>(null);
  const [showName, setShowName] = useState(false);

  // Filter media items based on search term
  const filteredList = list.filter((item) =>
    item.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const { db, cloud, isMobile, updater } =
    useContext(ControllerInfoContext) || {};

  const defaultItemsPerRow = isMobile ? "grid-cols-3" : "grid-cols-5";

  const [visibleButtons, setVisibleButtons] = useState<{
    [key: string]: boolean;
  }>({});

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

  useEffect(() => {
    // Reset visibility states when pathname changes
    setVisibleButtons({});
  }, [location.pathname]);

  const handleButtonVisibility = (
    buttonId: string,
    isVisible: boolean,
    isDisabled?: boolean
  ) => {
    if (isVisible && !isDisabled && !visibleButtons[buttonId]) {
      setVisibleButtons((prev) => ({ ...prev, [buttonId]: true }));
    }
  };

  const showDeleteConfirmation = () => {
    if (!selectedMedia.id) return;

    const mediaItem = list.find((item) => item.id === selectedMedia.id);
    if (!mediaItem) return;

    setMediaToDelete(mediaItem);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!db || !cloud || !mediaToDelete) return;

    try {
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

      // Remove from local list
      const updatedList = list.filter((item) => item.id !== mediaToDelete.id);
      dispatch(updateMediaList(updatedList));
      setSelectedMedia(emptyMedia);
    } catch (error) {
      console.error("Error deleting background:", error);
      // Still remove from local list even if Cloudinary deletion fails
      const updatedList = list.filter((item) => item.id !== mediaToDelete.id);
      dispatch(updateMediaList(updatedList));
      setSelectedMedia(emptyMedia);
    } finally {
      setShowDeleteModal(false);
      setMediaToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setMediaToDelete(null);
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
    };

    dispatch(addItemToMediaList(newMedia));
  };

  return (
    <ErrorBoundary>
      <div
        className={`mx-2 px-2 bg-gray-900 rounded-t-md flex items-center text-sm relative z-10 transition-all ${
          isMediaExpanded ? "mt-2" : "mt-4"
        }`}
      >
        <Button
          variant="tertiary"
          disabled={isLoading}
          className={cn(
            "mr-2",
            !location.pathname.includes("item") && "hidden",
            visibleButtons["clearBackground"] && "button-appear"
          )}
          svg={ClearBackgroundSVG}
          onClick={() => {
            if (db) {
              dispatch(
                updateSlideBackground({
                  background: "",
                })
              );
            }
          }}
        >
          {isMobile ? "" : "Remove"}
        </Button>
        <Button
          variant="tertiary"
          disabled={selectedMedia.id === "" || isLoading}
          className={cn(
            "mr-2",
            !location.pathname.includes("item") && "hidden",
            visibleButtons["setItem"] && "button-appear"
          )}
          svg={BgAll}
          onClick={() => {
            if (selectedMedia.background && db) {
              dispatch(
                updateAllSlideBackgrounds({
                  background: selectedMedia.background,
                  mediaInfo: selectedMedia,
                })
              );
            }
          }}
          // ref={(el) => {
          //   if (el) {
          //     handleButtonVisibility(
          //       "setItem",
          //       location.pathname.includes("item"),
          //       selectedMedia.id === "" || isLoading
          //     );
          //   }
          // }}
        >
          {isMobile ? "" : "Set Item"}
        </Button>
        <Button
          variant="tertiary"
          disabled={selectedMedia.id === "" || isLoading}
          className={cn(
            !location.pathname.includes("item") && "hidden",
            visibleButtons["setSlide"] && "button-appear"
          )}
          svg={BGOne}
          onClick={() => {
            if (selectedMedia.background && db) {
              dispatch(
                updateSlideBackground({
                  background: selectedMedia.background,
                  mediaInfo: selectedMedia,
                })
              );
            }
          }}
          // ref={(el) => {
          //   if (el) {
          //     handleButtonVisibility(
          //       "setSlide",
          //       location.pathname.includes("item"),
          //       selectedMedia.id === "" || isLoading
          //     );
          //   }
          // }}
        >
          {isMobile ? "" : "Set Slide"}
        </Button>
        <Button
          variant="tertiary"
          disabled={selectedMedia.id === ""}
          className={cn(
            !(
              location.pathname.includes("overlays") &&
              selectedOverlay?.type === "image"
            ) && "hidden",
            visibleButtons["setImageOverlay"] && "button-appear"
          )}
          svg={BGOne}
          onClick={() => {
            if (selectedMedia.background && db) {
              dispatch(
                updateOverlay({
                  imageUrl: selectedMedia.background,
                  id: selectedOverlay?.id,
                })
              );
              // Update state
              dispatch(
                updateOverlayInList({
                  imageUrl: selectedMedia.background,
                  id: selectedOverlay?.id,
                })
              );
            }
          }}
          ref={(el) => {
            if (el) {
              handleButtonVisibility(
                "setImageOverlay",
                location.pathname.includes("overlays") &&
                  selectedOverlay?.type === "image",
                selectedMedia.id === ""
              );
            }
          }}
        >
          {isMobile ? "" : "Set Image Overlay"}
        </Button>
        <Button
          variant="tertiary"
          disabled={selectedMedia.id === "" || !selectedPreference}
          className={cn(
            (!location.pathname.includes("preferences") ||
              tab !== "defaults") &&
              "hidden",
            visibleButtons["setBackground"] && "button-appear"
          )}
          svg={BGOne}
          onClick={() => {
            dispatch(
              setDefaultPreferences({
                [selectedPreference]: selectedMedia.background,
              })
            );
          }}
          ref={(el) => {
            if (el) {
              handleButtonVisibility(
                "setBackground",
                location.pathname.includes("preferences") && tab === "defaults",
                selectedMedia.id === "" || !selectedPreference
              );
            }
          }}
        >
          {isMobile ? "" : "Set Background"}
        </Button>
        <Button
          variant="tertiary"
          disabled={!selectedQuickLink || selectedMedia.id === ""}
          className={cn(
            (!location.pathname.includes("preferences") ||
              tab !== "quickLinks" ||
              selectedQuickLink?.linkType !== "media") &&
              "hidden",
            visibleButtons["setQuickLink"] && "button-appear"
          )}
          svg={BGOne}
          onClick={() => {
            dispatch(setSelectedQuickLinkImage(selectedMedia));
          }}
          ref={(el) => {
            if (el) {
              const isVisible = Boolean(
                location.pathname.includes("preferences") &&
                  tab === "quickLinks" &&
                  selectedQuickLink?.linkType === "media"
              );
              const isDisabled = Boolean(
                !selectedQuickLink ||
                  selectedMedia.id === "" ||
                  selectedQuickLink?.linkType !== "media"
              );
              handleButtonVisibility("setQuickLink", isVisible, isDisabled);
            }
          }}
        >
          {isMobile ? "" : "Set Quick Link Background"}
        </Button>
        <Button
          className="lg:ml-2 max-lg:mx-auto"
          svg={isMediaExpanded ? CollapseSVG : ExpandSVG}
          onClick={() => {
            dispatch(setIsMediaExpanded(!isMediaExpanded));
            if (isMediaExpanded) {
              setSearchTerm("");
            }
          }}
        />
        <CloudinaryUploadWidget
          uwConfig={{
            uploadPreset: "bpqu4ma5",
            cloudName: "portable-media",
          }}
          onComplete={(info) => {
            addNewBackground(info);
          }}
        />
        <Button
          variant="tertiary"
          disabled={selectedMedia.id === ""}
          svg={DeleteSVG}
          onClick={() => showDeleteConfirmation()}
        />
      </div>
      {!isMediaLoading && isMediaExpanded && (
        <div className="flex gap-2 justify-center z-10 py-1 bg-gray-900 mx-2 h-6">
          <Button
            variant="tertiary"
            svg={ZoomOutSVG}
            onClick={() => dispatch(increaseMediaItems())}
          />
          <Button
            variant="tertiary"
            svg={ZoomInSVG}
            onClick={() => dispatch(decreaseMediaItems())}
          />
        </div>
      )}
      {!isMediaLoading && isMediaExpanded && (
        <div className="px-4 py-2 bg-gray-900 mx-2 flex items-center max-md:flex-col max-md:gap-4">
          <Input
            type="text"
            label="Search"
            value={searchTerm}
            onChange={(value) => {
              setSearchTerm(value as string);
              if (value) {
                setShowName(true);
              }
            }}
            placeholder="Name"
            className="flex gap-4 items-center flex-1"
            inputWidth="w-full"
            inputTextSize="text-sm"
          />
          <Toggle
            className="ml-2"
            label="Show Name"
            value={showName}
            onChange={() => setShowName(!showName)}
          />
        </div>
      )}
      {isMediaLoading && (
        <h3 className="text-center font-lg pt-4 bg-gray-800 mx-2 h-full">
          Loading media...
        </h3>
      )}
      {!isMediaLoading && filteredList.length !== 0 && (
        <ul
          className={`media-items ${
            isMediaExpanded ? sizeMap.get(mediaItemsPerRow) : defaultItemsPerRow
          }`}
        >
          {filteredList.map((mediaItem) => {
            const { id, thumbnail, name } = mediaItem;
            const isSelected = id === selectedMedia.id;
            const shownName = name.includes("/")
              ? name.split("/").slice(1).join("/")
              : name;
            return (
              <li key={id}>
                <Button
                  variant="none"
                  padding="p-0"
                  className={cn(
                    "w-full h-full justify-center flex flex-col items-center border-2",
                    isSelected
                      ? "border-cyan-400"
                      : "border-gray-500 hover:border-gray-300"
                  )}
                  onClick={() => {
                    setSelectedMedia(mediaItem);
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
                        className="text-xs text-gray-300 truncate"
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
        </ul>
      )}
      {!isMediaLoading && searchTerm && filteredList.length === 0 && (
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
        itemName={mediaToDelete?.name}
        title="Delete Media"
        imageUrl={mediaToDelete?.thumbnail}
      />
    </ErrorBoundary>
  );
};

export default Media;
