import { useContext, useEffect, useState } from "react";
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
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import {
  updateAllSlideBackgrounds,
  updateSlideBackground,
} from "../../store/itemSlice";
import "./Media.scss";
import { DBMedia } from "../../types";
import {
  initiateMediaList,
  updateMediaList,
  updateMediaListFromRemote,
} from "../../store/mediaSlice";
import { retrieveImages } from "../../utils/itemUtil";
import CloudinaryUploadWidget, {
  imageInfoType,
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
import { updateOverlayPartial } from "../../store/overlaysSlice";
import { RootState } from "../../store/store";

const sizeMap: Map<number, string> = new Map([
  [7, "grid-cols-7"],
  [6, "grid-cols-6"],
  [5, "grid-cols-5"],
  [4, "grid-cols-4"],
  [3, "grid-cols-3"],
  [2, "grid-cols-2"],
]);

const emptyMedia = { id: "", background: "", type: "" };

const Media = () => {
  const dispatch = useDispatch();
  const location = useLocation();

  const { list } = useSelector(
    (state: RootState) => state.undoable.present.media
  );
  const { isLoading } = useSelector(
    (state: RootState) => state.undoable.present.item
  );
  const { type: selectedOverlayType, id: selectedOverlayId } = useSelector(
    (state: RootState) => state.undoable.present.overlays
  );
  const {
    isMediaExpanded,
    mediaItemsPerRow,
    selectedPreference,
    tab,
    selectedQuickLink,
  } = useSelector((state: RootState) => state.undoable.present.preferences);

  const [selectedMedia, setSelectedMedia] = useState<{
    id: string;
    background: string;
    type: string;
  }>(emptyMedia);
  const [isMediaLoading, setIsMediaLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [mediaToDelete, setMediaToDelete] = useState<{
    id: string;
    name: string;
    background: string;
    thumbnail: string;
  } | null>(null);

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
      const images = retrieveImages({ backgrounds, cloud });
      dispatch(initiateMediaList(images));
      setIsMediaLoading(false);
    };
    getAllItems();
  }, [dispatch, db, cloud]);

  useEffect(() => {
    if (!updater || !cloud) return;

    const updateMediaList = async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "images") {
            console.log("updating media from remote");
            const update = _update as DBMedia;
            const images = retrieveImages({
              backgrounds: update.backgrounds,
              cloud,
            });
            dispatch(updateMediaListFromRemote(images));
          }
        }
      } catch (e) {
        console.error(e);
      }
    };

    updater.addEventListener("update", updateMediaList);

    return () => updater.removeEventListener("update", updateMediaList);
  }, [updater, dispatch, cloud]);

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

    setMediaToDelete({
      id: selectedMedia.id,
      name: mediaItem.name || "this media",
      background: mediaItem.background,
      thumbnail: mediaItem.thumbnail,
    });
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!db || !cloud || !mediaToDelete) return;

    try {
      // Extract public_id from the background URL
      const publicId = extractPublicId(mediaToDelete.background);

      if (publicId) {
        // Delete from Cloudinary
        const cloudinarySuccess = await deleteFromCloudinary(cloud, publicId);
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
    resource_type,
    thumbnail_url,
  }: imageInfoType) => {
    const updatedList = [
      ...list,
      {
        category: "uncategorized",
        name: public_id,
        type: resource_type,
        id: generateRandomId(),
        background: secure_url,
        thumbnail: thumbnail_url,
      },
    ];
    dispatch(updateMediaList(updatedList));
  };

  return (
    <>
      <div
        className={`mx-2 px-2 bg-gray-900 rounded-t-md flex items-center text-sm relative z-10 transition-all ${
          isMediaExpanded ? "mt-2" : "mt-4"
        }`}
      >
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
                updateSlideBackground({ background: selectedMedia.background })
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
              selectedOverlayType === "image"
            ) && "hidden",
            visibleButtons["setImageOverlay"] && "button-appear"
          )}
          svg={BGOne}
          onClick={() => {
            if (selectedMedia.background && db) {
              dispatch(
                updateOverlayPartial({
                  imageUrl: selectedMedia.background,
                  id: selectedOverlayId,
                })
              );
            }
          }}
          ref={(el) => {
            if (el) {
              handleButtonVisibility(
                "setImageOverlay",
                location.pathname.includes("overlays") &&
                  selectedOverlayType === "image",
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
              selectedQuickLink?.linkType !== "image") &&
              "hidden",
            visibleButtons["setQuickLink"] && "button-appear"
          )}
          svg={BGOne}
          onClick={() => {
            dispatch(setSelectedQuickLinkImage(selectedMedia.background));
          }}
          ref={(el) => {
            if (el) {
              const isVisible = Boolean(
                location.pathname.includes("preferences") &&
                  tab === "quickLinks" &&
                  selectedQuickLink?.linkType === "image"
              );
              const isDisabled = Boolean(
                !selectedQuickLink ||
                  selectedMedia.id === "" ||
                  selectedQuickLink?.linkType !== "image"
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
        <div className="px-4 py-2 bg-gray-900 mx-2">
          <Input
            type="text"
            label="Search"
            value={searchTerm}
            onChange={(value) => setSearchTerm(value as string)}
            placeholder="name"
            className="flex gap-4 items-center"
            inputWidth="w-full"
            inputTextSize="text-sm"
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
          {filteredList.map(({ id, thumbnail, background, type, name }) => {
            const isSelected = id === selectedMedia.id;
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
                    if (type === "video") {
                      // add mp4 extension to the url
                      // Insert before the ?
                      // Comes in the format:
                      // https://res.cloudinary.com/portable-media/video/upload/v1/backgrounds/Lower_thirds_1_1920_x_300_px_y9g3pq?_a=DATAg1AAZAA0
                      const updatedBackground =
                        background.slice(0, background.indexOf("?")) + ".mp4";
                      setSelectedMedia({
                        id,
                        background: updatedBackground,
                        type,
                      });
                    } else {
                      setSelectedMedia({ id, background, type });
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

                  {isMediaExpanded && name && (
                    <div className="w-full px-1 py-1 text-center">
                      <p
                        className="text-xs text-gray-300 truncate"
                        title={name}
                      >
                        {name.split("/").slice(1).join("/")}
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
    </>
  );
};

export default Media;
