import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import Button from "../Button/Button";
import { Slider } from "../ui/Slider";
import { useInterfaceZoom } from "../../hooks/useInterfaceZoom";
import type { MenuItemType } from "../../types";

/** Zoom slider block used inside operator Menu dropdowns. */
export const InterfaceZoomMenuControl = () => {
  const {
    zoomLevel,
    zoomMin,
    zoomMax,
    zoomStep,
    setZoomWithinBounds,
    resetZoom,
  } = useInterfaceZoom();

  return (
    <div className="flex w-full min-w-52 flex-col gap-2 px-2 py-1.5">
      <div className="flex items-center justify-center gap-2">
        <span className="min-w-12 text-center text-xs font-semibold">
          {zoomLevel}%
        </span>
        <Button
          svg={RotateCcw}
          onClick={resetZoom}
          className="justify-center"
          disabled={zoomLevel === 100}
          variant="secondary"
          // Keep compact in menus; Button otherwise uses xl icons when isMobile is sticky.
          iconSize="sm"
        />
      </div>
      <div className="flex w-full items-center justify-center gap-1 px-0.5">
        <Button
          variant="tertiary"
          className="h-7 w-7 min-h-0 max-md:min-h-0 justify-center p-0"
          svg={ZoomOut}
          color="#ffffff"
          iconSize="sm"
          title="Zoom out"
          aria-label="Zoom out interface"
          disabled={zoomLevel <= zoomMin}
          onClick={() => setZoomWithinBounds(zoomLevel - zoomStep)}
        />
        <div className="w-36 shrink-0">
          <Slider
            value={[zoomLevel]}
            onValueChange={(v: number[]) =>
              setZoomWithinBounds(v[0] ?? 100)
            }
            min={zoomMin}
            max={zoomMax}
            step={zoomStep}
            className="w-full"
            aria-label="Interface zoom"
          />
        </div>
        <Button
          variant="tertiary"
          className="h-7 w-7 min-h-0 max-md:min-h-0 justify-center p-0"
          svg={ZoomIn}
          color="#ffffff"
          iconSize="sm"
          title="Zoom in"
          aria-label="Zoom in interface"
          disabled={zoomLevel >= zoomMax}
          onClick={() => setZoomWithinBounds(zoomLevel + zoomStep)}
        />
      </div>
    </div>
  );
};

export const interfaceZoomMenuItem: MenuItemType = {
  element: <InterfaceZoomMenuControl />,
  className:
    "p-0 hover:bg-transparent focus:bg-transparent hover:text-inherit focus:text-inherit",
  preventClose: true,
};

export default InterfaceZoomMenuControl;
