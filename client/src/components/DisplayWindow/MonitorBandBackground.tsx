import { Box } from "../../types";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import {
  isUnavailableLocalVideoFile,
  useLocalVideoFileUrl,
} from "../../hooks/useLocalVideoFileUrl";
import LocalSourceStatus, {
  getUnavailableLocalVideoStatusProps,
} from "./LocalSourceStatus";
import type { LocalSourceStatusSize } from "./LocalSourceStatus";
import { isLocalMediaReferenceUrl } from "../../utils/localMediaReferenceUrl";

type MonitorBandBackgroundProps = {
  box?: Box;
  showLocalSourceStatus?: boolean;
  scaleFactor?: number;
  statusSize?: LocalSourceStatusSize;
  localVideoThumbnailUrl?: string;
};

/**
 * Full-frame background for the monitor's next-slide band layout.
 *
 * The bands are text-only, so a per-band background would squash the image into
 * a 200px strip and paint it twice. One layer behind both bands matches what the
 * room sees. The scrim keeps band text readable over a busy image, which is the
 * whole reason the monitor exists.
 */
const MonitorBandBackground = ({
  box,
  showLocalSourceStatus = false,
  scaleFactor = 1,
  statusSize = "canvas",
  localVideoThumbnailUrl,
}: MonitorBandBackgroundProps) => {
  const isVideoBg = box?.mediaInfo?.type === "video";
  // Video backgrounds show their still frame here; a playing video behind the
  // bands costs decode work on the monitor for no added readability.
  const rawImage = isVideoBg
    ? box?.mediaInfo?.placeholderImage
    : box?.background;
  const localImage = useLocalImageUrl(box?.mediaInfo?.localImage);
  const localVideo = useLocalVideoFileUrl(box?.mediaInfo?.localVideoFile);
  const unavailableLocalVideo = isUnavailableLocalVideoFile(localVideo);
  const suppressUnavailableVideoStill =
    unavailableLocalVideo && statusSize !== "thumbnail";
  const cachedImage = useCachedMediaUrl(
    suppressUnavailableVideoStill ? undefined : rawImage,
  );
  const displayImage =
    suppressUnavailableVideoStill
      ? undefined
      : localVideoThumbnailUrl ||
        (localImage.isLocalImage
          ? localImage.url ??
            ((localImage.status === "unavailable" ||
              localImage.status === "loading") &&
            !isLocalMediaReferenceUrl(rawImage)
              ? cachedImage
              : undefined)
          : cachedImage);
  const unavailableImage =
    showLocalSourceStatus &&
    localImage.isLocalImage &&
    localImage.status === "unavailable" &&
    !displayImage;
  const unavailableVideo =
    showLocalSourceStatus &&
    isVideoBg &&
    unavailableLocalVideo &&
    (!box?.mediaInfo?.background ||
      isLocalMediaReferenceUrl(box.mediaInfo.background));
  const loadingImage =
    showLocalSourceStatus &&
    localImage.isLocalImage &&
    localImage.status === "loading" &&
    !displayImage;
  const loadingVideo =
    showLocalSourceStatus &&
    isVideoBg &&
    localVideo.isLocalVideoFile &&
    localVideo.status === "loading" &&
    !displayImage &&
    (!box?.mediaInfo?.background ||
      isLocalMediaReferenceUrl(box.mediaInfo.background));

  if (
    !displayImage &&
    !unavailableImage &&
    !unavailableVideo &&
    !loadingImage &&
    !loadingVideo
  ) {
    return null;
  }

  // Negative z sits above the layout's black base but behind the bands, which
  // are in normal flow and would otherwise be painted over.
  return (
    <>
      {displayImage ? (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: -1 }}
          data-testid="monitor-band-background"
          aria-hidden
        >
          <img
            data-testid={
              localVideoThumbnailUrl
                ? "monitor-band-video-thumbnail"
                : undefined
            }
            className="monitor-band-background h-full w-full absolute object-cover"
            src={displayImage}
            alt=""
          />
          <div className="absolute inset-0 bg-black/60" />
        </div>
      ) : null}
      {unavailableImage ? (
        <LocalSourceStatus
          sourceLabel={`Local image · ${box?.mediaInfo?.localImage?.fileName || "Background"}`}
          ownerLabel={localImage.isOwner ? undefined : box?.mediaInfo?.localImage?.ownerLabel}
          heading={localImage.isOwner ? "Local image unavailable" : undefined}
          detail={localImage.isOwner ? "Open this item on this device and choose Relink." : undefined}
          size={statusSize}
          scaleFactor={scaleFactor}
          className="pointer-events-none"
        />
      ) : loadingImage ? (
        <LocalSourceStatus
          sourceLabel={`Local image · ${box?.mediaInfo?.localImage?.fileName || "Background"}`}
          heading="Loading local image"
          state="loading"
          size={statusSize}
          scaleFactor={scaleFactor}
          className="pointer-events-none"
        />
      ) : loadingVideo ? (
        <LocalSourceStatus
          sourceLabel={`Local video · ${box?.mediaInfo?.localVideoFile?.fileName || "Background"}`}
          heading="Loading local video"
          state="loading"
          size={statusSize}
          scaleFactor={scaleFactor}
          className="pointer-events-none"
        />
      ) : unavailableVideo ? (
        <LocalSourceStatus
          {...getUnavailableLocalVideoStatusProps(
            box?.mediaInfo?.localVideoFile,
            localVideo.isOwner,
            box?.mediaInfo?.name,
          )}
          size={statusSize}
          scaleFactor={scaleFactor}
          className="pointer-events-none"
        />
      ) : null}
    </>
  );
};

export default MonitorBandBackground;
