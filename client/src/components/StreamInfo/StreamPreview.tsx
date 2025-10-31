import { memo, useMemo } from "react";
import { ServiceTimePosition } from "../../types";

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
  const nameFontSize = nameSize / 10 / (100 / 50);
  const timeFontSize = timeSize / 10 / (100 / 50);

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
    <div className="flex flex-col gap-2 w-[50vw] max-md:w-[calc(100vw-2rem)] aspect-video">
      <div className="text-sm text-gray-300">Preview</div>
      <div className="w-full h-full border border-gray-600 bg-gray-300 rounded relative overflow-hidden">
        <div
          className={`absolute ${positionClasses} transform px-[1%] py-[0.5%] rounded-[5%_/_10%] font-semibold select-none flex flex-col items-center justify-center text-center`}
          style={{ color, backgroundColor: background, maxWidth: "90%" }}
        >
          {shouldShowName && (
            <div
              className="leading-none"
              style={{ fontSize: `${nameFontSize}vw` }}
            >
              {name || "Service Name"} begins in
            </div>
          )}
          <div
            className="leading-none"
            style={{ fontSize: `${timeFontSize}vw` }}
          >
            12:34
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(StreamPreview);
