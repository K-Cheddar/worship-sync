import { useContext, useEffect } from "react";
import Button from "../../components/Button/Button";
import Menu from "../../components/Menu/Menu";
import { RemoteDbContext } from "../../context/remoteDb";
import { useDispatch, useSelector } from "../../hooks";
import {
  updateAllSlideBackgrounds,
  updateSlideBackground,
} from "../../store/itemSlice";
import { dummyMedia } from "./dummyMedia";
import "./Media.scss";
import { DBMedia } from "../../types";
import { initiateMediaList } from "../../store/media";
import { Cloudinary } from "@cloudinary/url-gen";
import { retrieveImages } from "../../utils/itemUtil";

const cloud = new Cloudinary({
  cloud: {
    cloudName: "portable-media",
    apiKey: process.env.REACT_APP_CLOUDINARY_KEY,
    apiSecret: process.env.REACT_APP_CLOUDINARY_SECRET,
  },
});

const Media = () => {
  const dispatch = useDispatch();
  const images = dummyMedia;

  const { list } = useSelector((state) => state.media);

  const { db } = useContext(RemoteDbContext) || {};

  useEffect(() => {
    const getAllItems = async () => {
      const response: DBMedia | undefined = await db?.get("images");
      const backgrounds = response?.backgrounds || [];
      console.log({ backgrounds });
      const images = retrieveImages({ backgrounds, cloud });
      console.log({ images });
      dispatch(initiateMediaList(images));
    };

    getAllItems();
  }, [dispatch, db]);

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
                menuItems={[
                  {
                    text: "Set Item Background",
                    onClick: () => dispatch(updateAllSlideBackgrounds(image)),
                  },
                  {
                    text: "Set Slide Background",
                    onClick: () => dispatch(updateSlideBackground(image)),
                  },
                ]}
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
