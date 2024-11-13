import { useContext, useEffect } from "react";
import Button from "../../components/Button/Button";
import Menu from "../../components/Menu/Menu";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useDispatch, useSelector } from "../../hooks";
import {
  updateAllSlideBackgrounds,
  updateSlideBackground,
} from "../../store/itemSlice";
import "./Media.scss";
import { DBMedia } from "../../types";
import { initiateMediaList } from "../../store/media";
import { retrieveImages } from "../../utils/itemUtil";
import { useLocation } from "react-router-dom";

const Media = () => {
  const dispatch = useDispatch();
  const location = useLocation();

  const { list } = useSelector((state) => state.media);
  const { isLoading } = useSelector((state) => state.undoable.present.item);

  const { db, cloud } = useContext(GlobalInfoContext) || {};

  useEffect(() => {
    const getAllItems = async () => {
      if (!db || !cloud) return;
      const response: DBMedia | undefined = await db?.get("images");
      const backgrounds = response?.backgrounds || [];
      const images = retrieveImages({ backgrounds, cloud });
      dispatch(initiateMediaList(images));
    };

    getAllItems();
  }, [dispatch, db, cloud]);

  return (
    <>
      <h2 className="text-lg font-semibold text-center mt-4 pb-2 pt-1 mx-2 bg-slate-800 rounded-t-md">
        Media
      </h2>
      <ul className="media-items">
        {list.map(({ id, image }, index) => {
          return (
            <li
              className="self-center border border-slate-500 flex items-center justify-center aspect-video hover:border-slate-300 cursor-pointer"
              key={id}
            >
              <Menu
                menuItems={
                  isLoading || !location.pathname.includes("/item/")
                    ? []
                    : [
                        {
                          text: "Set Item Background",
                          onClick: () =>
                            dispatch(updateAllSlideBackgrounds(image)),
                        },
                        {
                          text: "Set Slide Background",
                          onClick: () => dispatch(updateSlideBackground(image)),
                        },
                      ]
                }
                TriggeringButton={
                  <Button
                    variant="none"
                    padding="p-0"
                    className="w-full h-full justify-center"
                  >
                    <img
                      className="max-w-full max-h-full"
                      alt={id}
                      src={image}
                      loading="lazy"
                    />
                  </Button>
                }
              />
            </li>
          );
        })}
      </ul>
    </>
  );
};

export default Media;
