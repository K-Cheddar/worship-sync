import { Box } from "../../types";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";

type MonitorBandBackgroundProps = {
  box?: Box;
};

/**
 * Full-frame background for the monitor's next-slide band layout.
 *
 * The bands are text-only, so a per-band background would squash the image into
 * a 200px strip and paint it twice. One layer behind both bands matches what the
 * room sees. The scrim keeps band text readable over a busy image, which is the
 * whole reason the monitor exists.
 */
const MonitorBandBackground = ({ box }: MonitorBandBackgroundProps) => {
  const isVideoBg = box?.mediaInfo?.type === "video";
  // Video backgrounds show their still frame here; a playing video behind the
  // bands costs decode work on the monitor for no added readability.
  const rawImage = isVideoBg
    ? box?.mediaInfo?.placeholderImage
    : box?.background;
  const localImage = useLocalImageUrl(box?.mediaInfo?.localImage);
  const cachedImage = useCachedMediaUrl(rawImage);
  const displayImage = localImage.isLocalImage ? localImage.url : cachedImage;

  if (!displayImage) return null;

  // Negative z sits above the layout's black base but behind the bands, which
  // are in normal flow and would otherwise be painted over.
  return (
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
  );
};

export default MonitorBandBackground;
