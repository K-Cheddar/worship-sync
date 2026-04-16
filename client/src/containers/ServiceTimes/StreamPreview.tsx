import { memo, useMemo } from "react";
import { ServiceTimePosition } from "../../types";
import ServiceTimeCountdownFace, {
  serviceTimeEditPreviewFaceLayoutProps,
} from "./ServiceTimeCountdownFace";

type Props = {
  name: string;
  color: string;
  background: string;
  nameSize: number;
  timeSize: number;
  shouldShowName: boolean;
  position?: ServiceTimePosition;
  /** Desktop: cap total column height to match the edit form column (px). */
  maxColumnHeightPx?: number | null;
};

const StreamPreview = ({
  name,
  color,
  background,
  nameSize,
  timeSize,
  shouldShowName,
  position = "top-right",
  maxColumnHeightPx = null,
}: Props) => {
  const positionClasses = useMemo(() => {
    switch (position) {
      case "top-left":
        return "top-[1%] left-[1%]";
      case "bottom-left":
        return "bottom-[1%] left-[1%]";
      case "bottom-right":
        return "bottom-[1%] right-[1%]";
      case "center":
        return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
      case "top-right":
      default:
        return "top-[1%] right-[1%]";
    }
  }, [position]);

  const hasHeightCap = maxColumnHeightPx != null;
  const columnStyle = hasHeightCap
    ? { maxHeight: maxColumnHeightPx }
    : undefined;

  const frame = (
    <div
      className={`relative aspect-video w-full max-w-full overflow-hidden rounded-md border border-white/12 bg-black/30 @container${hasHeightCap ? " max-h-full" : ""
        }`}
    >
      <div className={`absolute ${positionClasses} transform`}>
        <ServiceTimeCountdownFace
          {...serviceTimeEditPreviewFaceLayoutProps}
          service={{
            name: name || "Service Name",
            color,
            background,
            nameFontSize: nameSize,
            timeFontSize: timeSize,
            shouldShowName,
          }}
          timeText="12:34"
          extraSurfaceStyle={{ maxWidth: "90%" }}
        />
      </div>
    </div>
  );

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-2 md:min-h-0 md:min-w-0 md:flex-1"
      style={columnStyle}
    >
      <p className="shrink-0 text-sm text-gray-300">Preview</p>
      {hasHeightCap ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {frame}
        </div>
      ) : (
        frame
      )}
    </div>
  );
};

export default memo(StreamPreview);
