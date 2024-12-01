import { useContext, useEffect, useState } from "react";
import Button from "../../components/Button/Button";
import { ReactComponent as BgAll } from "../../assets/icons/background-all.svg";
import { ReactComponent as BGOne } from "../../assets/icons/background-one.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import {
  updateAllSlideBackgrounds,
  updateSlideBackground,
} from "../../store/itemSlice";
import "./Media.scss";
import { DBMedia } from "../../types";
import { initiateMediaList, updateMediaList } from "../../store/mediaSlice";
import { retrieveImages } from "../../utils/itemUtil";
import CloudinaryUploadWidget, {
  imageInfoType,
} from "./CloudinaryUploadWidget";
import generateRandomId from "../../utils/generateRandomId";

const Media = () => {
  const dispatch = useDispatch();

  const { list } = useSelector((state) => state.media);
  const { isLoading } = useSelector((state) => state.undoable.present.item);

  const [selectedMedia, setSelectedMedia] = useState<{
    id: string;
    image: string;
  }>({ id: "", image: "" });
  const [isMediaLoading, setIsMediaLoading] = useState(true);

  const { db, cloud } = useContext(ControllerInfoContext) || {};

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

  const deleteBackground = async () => {
    if (!db) return;
    const updatedList = list.filter((item) => item.id !== selectedMedia.id);
    dispatch(updateMediaList(updatedList));
  };

  const addNewBackground = ({ public_id, secure_url, type }: imageInfoType) => {
    const updatedList = [
      ...list,
      {
        category: "uncategorized",
        name: public_id,
        type,
        id: generateRandomId(),
        image: secure_url,
      },
    ];
    dispatch(updateMediaList(updatedList));
  };

  return (
    <>
      <div className="mt-4 mx-2 px-2 bg-slate-900 rounded-t-md flex items-center text-sm">
        <Button
          variant="tertiary"
          disabled={selectedMedia.id === "" || isLoading}
          className="mr-2"
          svg={BgAll}
          onClick={() => {
            if (selectedMedia && db) {
              dispatch(
                updateAllSlideBackgrounds({
                  background: selectedMedia.image,
                })
              );
            }
          }}
        >
          Set Item
        </Button>
        <Button
          variant="tertiary"
          disabled={selectedMedia.id === "" || isLoading}
          svg={BGOne}
          onClick={() => {
            if (selectedMedia && db) {
              dispatch(
                updateSlideBackground({ background: selectedMedia.image })
              );
            }
          }}
        >
          Set Slide
        </Button>
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
          disabled={selectedMedia.id === "" || isLoading}
          svg={DeleteSVG}
          onClick={() => deleteBackground()}
        />
      </div>
      {isMediaLoading && (
        <h3 className="text-center font-lg pt-4 bg-slate-800 mx-2 h-full">
          Loading media...
        </h3>
      )}
      {list.length !== 0 && (
        <ul className="media-items">
          {list.map(({ id, image }) => {
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
                    setSelectedMedia({ id, image });
                  }}
                >
                  <img
                    className="max-w-full max-h-full"
                    alt={id}
                    src={image}
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
