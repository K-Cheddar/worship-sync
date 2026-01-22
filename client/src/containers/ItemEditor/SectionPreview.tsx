import { useMemo } from "react";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { ItemSlideType } from "../../types";
import cn from "classnames";
import { useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import Button from "../../components/Button/Button";
import { Minimize2, Maximize2 } from "lucide-react";

const sizeMap: Map<number, string> = new Map([
  [7, "grid-cols-7"],
  [6, "grid-cols-6"],
  [5, "grid-cols-5"],
  [4, "grid-cols-4"],
  [3, "grid-cols-3"],
  [2, "grid-cols-2"],
  [1, "grid-cols-1"],
]);

type SectionPreviewProps = {
  selectedSection: {
    name: string;
    type: string;
  } | null;
  previewSlides: ItemSlideType[];
  isMinimized: boolean;
  onMinimizeToggle: (minimized: boolean) => void;
};

const SectionPreview = ({ selectedSection, previewSlides, isMinimized, onMinimizeToggle }: SectionPreviewProps) => {
  const { formattedLyricsPerRow } = useSelector(
    (state: RootState) => state.undoable.present.preferences
  );

  const sectionColor = useMemo(() => {
    if (!selectedSection) return "bg-stone-500";
    return itemSectionBgColorMap.get(selectedSection.type) || "bg-stone-500";
  }, [selectedSection]);

  const columnsPerRow = useMemo(() => {
    return (formattedLyricsPerRow || 4) + 1;
  }, [formattedLyricsPerRow]);

  const gridColsClass = useMemo(() => {
    return sizeMap.get(columnsPerRow) || "grid-cols-5";
  }, [columnsPerRow]);

  if (!selectedSection || previewSlides.length === 0) {
    return null;
  }

  return (
    <div className={cn(
      "border-t border-gray-600 flex flex-col min-h-0 min-w-0",
      isMinimized ? "pt-2" : "pt-4"
    )}>
      <div className="flex items-center justify-between shrink-0">
        <h3 className={cn("text-base font-semibold px-2 py-1 rounded-md", sectionColor)}>
          Preview: {selectedSection.name}
        </h3>
        <Button
          variant="tertiary"
          svg={isMinimized ? Maximize2 : Minimize2}
          onClick={() => onMinimizeToggle(!isMinimized)}
          className="shrink-0"
        />
      </div>
      {!isMinimized && (
        <div className={cn("grid gap-x-2 gap-y-0.5 overflow-y-auto overflow-x-hidden pb-2 scrollbar-variable min-w-0 mt-2", gridColsClass)}>
          {previewSlides.map((slide, index) => (
            <div key={slide.id} className="flex flex-col justify-start">
              <div className="w-full aspect-video shrink-0 relative">
                <DisplayWindow
                  displayType="projector"
                  showBorder
                  boxes={slide.boxes}
                  className="w-full h-full"
                />
              </div>
              <p className="text-xs text-center mt-0.5 text-gray-400">
                Slide {index + 1}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SectionPreview;
