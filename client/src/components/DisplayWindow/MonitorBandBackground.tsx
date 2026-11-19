import { Box } from "../../types";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";
import LocalSourceStatus from "./LocalSourceStatus";
import { isLocalMediaReferenceUrl } from "../../utils/localMediaReferenceUrl";

type MonitorBandBackgroundProps = {
  box?: Box;
  showLocalSourceStatus?: boolean;
  scaleFactor?: number;
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
}: MonitorBandBackgroundProps) => {
  const isVideoBg = box?.mediaInfo?.type === "video";
  // Video backgrounds show their still frame here; a playing video behind the
  // bands costs decode work on the monitor for no added readability.
  const rawImage = isVideoBg
    ? box?.mediaInfo?.placeholderImage
    : box?.background;
  const localImage = useLocalImageUrl(box?.mediaInfo?.localImage);
  const localVideo = useLocalVideoFileUrl(box?.mediaInfo?.localVideoFile);
  const cachedImage = useCachedMediaUrl(rawImage);
  const displayImage = localImage.isLocalImage
    ? localImage.url ??
      (localImage.status === "unavailable" && !isLocalMediaReferenceUrl(rawImage)
        ? cachedImage
        : undefined)
    : cachedImage;
  const unavailableImage =
    showLocalSourceStatus &&
    localImage.isLocalImage &&
    localImage.status === "unavailable" &&
    !displayImage;
  const unavailableVideo =
    showLocalSourceStatus &&
    isVideoBg &&
    localVideo.isLocalVideoFile &&
    localVideo.status === "unavailable" &&
    (!box?.mediaInfo?.background ||
      isLocalMediaReferenceUrl(box.mediaInfo.background));

  if (!displayImage && !unavailableImage && !unavailableVideo) return null;

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
          size="canvas"
          scaleFactor={scaleFactor}
          className="pointer-events-none"
        />
      ) : unavailableVideo ? (
        <LocalSourceStatus
          sourceLabel={`Local video · ${box?.mediaInfo?.localVideoFile?.fileName || "Background"}`}
          ownerLabel={localVideo.isOwner ? undefined : box?.mediaInfo?.localVideoFile?.ownerLabel}
          heading={localVideo.isOwner ? "Local video unavailable" : undefined}
          detail={localVideo.isOwner ? "Open Media on this device and relink the file." : undefined}
          size="canvas"
          scaleFactor={scaleFactor}
          className="pointer-events-none"
        />
      ) : null}
    </>
  );
};

export default MonitorBandBackground;
