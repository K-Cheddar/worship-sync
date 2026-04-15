import { memo, useMemo } from "react";
import { ServiceTimePosition } from "../../types";
import ServiceTimeCountdownFace from "./ServiceTimeCountdownFace";

type Props = {
  name: string;
  color: string;
  background: string;
  nameSize: number;
  timeSize: number;
  shouldShowName: boolean;
  position?: ServiceTimePosition;
};

const StreamPreview = ({
  name,
  color,
  background,
  nameSize,
  timeSize,
  shouldShowName,
  position = "top-right",
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

  return (
    <div className="flex flex-col gap-2 flex-1 max-h-full max-md:w-[calc(100vw-2rem)]">
      <div className="text-sm text-gray-300">Preview</div>
      <div className="relative aspect-video overflow-hidden rounded-md border border-white/12 bg-black/30">
        <div className={`absolute ${positionClasses} transform`}>
          <ServiceTimeCountdownFace
            service={{
              name: name || "Service Name",
              color,
              background,
              nameFontSize: nameSize,
              timeFontSize: timeSize,
              shouldShowName,
            }}
            timeText="12:34"
            fontSpec="preview"
            paddingSpec="viewportFraction"
            extraSurfaceStyle={{ maxWidth: "90%" }}
          />
        </div>
      </div>
    </div>
  );
};

export default memo(StreamPreview);
