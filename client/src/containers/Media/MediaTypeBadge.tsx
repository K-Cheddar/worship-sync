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
      <Icon svg={svg} size="xs" className="absolute bottom-1 left-1 opacity-50" />
  );
};

export default MediaTypeBadge;

