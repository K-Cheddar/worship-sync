import { Film, MonitorUp, Video } from "lucide-react";
import CachedMediaImage from "../../components/CachedMediaImage/CachedMediaImage";
import type { MediaType } from "../../types";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";
import { isMediaLibraryDesktopShare } from "./mediaLibraryOrigin";

type MediaLibraryMediaVisualProps = {
  mediaItem: MediaType;
  imageClassName?: string;
  imageAlt?: string;
  imageLoading?: "eager" | "lazy";
};

const MediaLibraryMediaVisual = ({
  mediaItem,
  imageClassName,
  imageAlt = mediaItem.id,
  imageLoading,
}: MediaLibraryMediaVisualProps) => {
  const localImage = useLocalImageUrl(mediaItem.localImage, "thumbnail");
  const localVideo = useLocalVideoFileUrl(
    mediaItem.localVideoFile,
    "thumbnail",
  );
  const resolvedThumbnail = localImage.isLocalImage
    ? localImage.url
    : localVideo.isLocalVideoFile
      ? localVideo.url
      : mediaItem.thumbnail;
  const shownName = mediaItem.name.includes("/")
    ? mediaItem.name.split("/").slice(1).join("/")
    : mediaItem.name;

  if (resolvedThumbnail) {
    return (
      <CachedMediaImage
        className={imageClassName}
        alt={imageAlt}
        src={resolvedThumbnail}
        loading={imageLoading}
        draggable={false}
      />
    );
  }

  if (mediaItem.localVideoInput) {
    return (
      <div className="flex max-w-full flex-col items-center justify-center gap-1 px-2">
        {isMediaLibraryDesktopShare(mediaItem) ? (
          <MonitorUp
            className="size-8 shrink-0 text-neutral-400"
            aria-hidden
          />
        ) : (
          <Video className="size-8 shrink-0 text-neutral-400" aria-hidden />
        )}
        <span
          className="max-w-full truncate text-center text-[10px] font-medium text-neutral-300"
          title={shownName || mediaItem.localVideoInput.label}
        >
          {shownName || mediaItem.localVideoInput.label}
        </span>
      </div>
    );
  }

  if (mediaItem.localVideoFile) {
    return <Film className="size-8 text-neutral-400" aria-hidden />;
  }

  return null;
};

export default MediaLibraryMediaVisual;
