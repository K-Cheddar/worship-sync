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
    ? localImage.url || mediaItem.thumbnail
    : localVideo.isLocalVideoFile
      ? localVideo.url || mediaItem.thumbnail
      : mediaItem.thumbnail;
  const shownName = mediaItem.name.includes("/")
    ? mediaItem.name.split("/").slice(1).join("/")
    : mediaItem.name;

  if (resolvedThumbnail) {
    return (
      <>
        <CachedMediaImage
          className={imageClassName}
          alt={imageAlt}
          src={resolvedThumbnail}
          loading={imageLoading}
          draggable={false}
        />
        {mediaItem.localVideoInput ? (
          <span
            className="pointer-events-none absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-1 text-[10px] font-semibold text-white shadow"
            title="Live video input"
            aria-label="Live video input"
          >
            {isMediaLibraryDesktopShare(mediaItem) ? (
              <MonitorUp className="size-3" aria-hidden />
            ) : (
              <Video className="size-3" aria-hidden />
            )}
            Live input
          </span>
        ) : null}
      </>
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
