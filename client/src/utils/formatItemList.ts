import { Cloudinary } from "@cloudinary/url-gen";
import { ServiceItem } from "../types";

export const formatItemList = (itemList: ServiceItem[], cloud: Cloudinary) => {
  return itemList.map((item) => {
    return {
      ...item,
      background: item.background?.startsWith("http")
        ? item.background
        : cloud.image(item.background).toURL(),
    };
  });
};
