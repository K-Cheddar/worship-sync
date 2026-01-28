import { Image, Video } from "lucide-react";
import { MediaType } from "../../types";
import Icon from "../../components/Icon/Icon";

type MediaTypeBadgeProps = {
  type: MediaType["type"];
};

const MediaTypeBadge = ({ type }: MediaTypeBadgeProps) => {
  const svg = type === "video"
    ? Video
    : Image;
  return (
      <Icon svg={svg} size="xs" className="absolute bottom-0.25 left-0.25 opacity-50 bg-black/50 rounded-full p-0.5" />
  );
};

export default MediaTypeBadge;

