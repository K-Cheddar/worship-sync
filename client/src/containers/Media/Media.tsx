import { useContext, useEffect, useState } from "react";
import Button from "../../components/Button/Button";
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
  decreaseMediaItems,
  increaseMediaItems,
  setIsMediaExpanded,
  setMediaItems,
} from "../../store/preferencesSlice";
import { useLocation } from "react-router-dom";

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

  const { list } = useSelector((state) => state.media);
  const { isLoading } = useSelector((state) => state.undoable.present.item);
  const { isMediaExpanded, mediaItemsPerRow } = useSelector(
    (state) => state.preferences
  );

  const [selectedMedia, setSelectedMedia] = useState<{
    id: string;
    background: string;
  }>({ id: "", background: "" });
  const [isMediaLoading, setIsMediaLoading] = useState(true);

  const { db, cloud, isMobile, updater } =
    useContext(ControllerInfoContext) || {};

  const defaultItemsPerRow = isMobile ? "grid-cols-3" : "grid-cols-5";

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

  const deleteBackground = async () => {
    if (!db) return;
    const updatedList = list.filter((item) => item.id !== selectedMedia.id);
    dispatch(updateMediaList(updatedList));
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
        className={`mx-2 px-2 bg-slate-900 rounded-t-md flex items-center text-sm relative z-10 transition-all ${
          isMediaExpanded ? "mt-2" : "mt-4"
        }`}
      >
        <Button
          variant="tertiary"
          disabled={
            selectedMedia.id === "" ||
            isLoading ||
            !location.pathname.includes("item")
          }
          className="mr-2"
          svg={BgAll}
          onClick={() => {
            if (selectedMedia && db) {
              dispatch(
                updateAllSlideBackgrounds({
                  background: selectedMedia.background,
                })
              );
            }
          }}
        >
          {isMobile ? "" : "Set Item"}
        </Button>
        <Button
          variant="tertiary"
          disabled={
            selectedMedia.id === "" ||
            isLoading ||
            !location.pathname.includes("item")
          }
          svg={BGOne}
          onClick={() => {
            if (selectedMedia && db) {
              dispatch(
                updateSlideBackground({ background: selectedMedia.background })
              );
            }
          }}
        >
          {isMobile ? "" : "Set Slide"}
        </Button>
        <Button
          className="lg:ml-2 max-lg:mx-auto"
          svg={isMediaExpanded ? CollapseSVG : ExpandSVG}
          onClick={() => dispatch(setIsMediaExpanded(!isMediaExpanded))}
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
          onClick={() => deleteBackground()}
        />
      </div>
      {!isMediaLoading && isMediaExpanded && (
        <div className="flex gap-2 justify-center z-10 py-1 bg-slate-900 mx-2 h-6">
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
      {isMediaLoading && (
        <h3 className="text-center font-lg pt-4 bg-slate-800 mx-2 h-full">
          Loading media...
        </h3>
      )}
      {!isMediaLoading && list.length !== 0 && (
        <ul
          className={`media-items ${
            isMediaExpanded ? sizeMap.get(mediaItemsPerRow) : defaultItemsPerRow
          }`}
        >
          {list.map(({ id, thumbnail, background }) => {
            const isSelected = id === selectedMedia.id;
            return (
              <li
                className={`self-center border-2 flex items-center justify-center aspect-video cursor-pointer ${
                  isSelected
                    ? "border-cyan-400"
                    : "border-slate-500 hover:border-slate-300"
                }`}
                key={id}
              >
                <Button
                  variant="none"
                  padding="p-0"
                  className="w-full h-full justify-center"
                  onClick={() => {
                    setSelectedMedia({ id, background });
                  }}
                >
                  <img
                    className="max-w-full max-h-full"
                    alt={id}
                    src={thumbnail}
                    loading="lazy"
                  />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};

export default Media;
