import { useContext } from "react";
import {
  RectangleEllipsis,
  Layers,
  ScrollText,
  Clock,
  Check,
  RefreshCcw,
  Settings,
} from "lucide-react";
import { useDispatch, useSelector } from "../../../hooks";
import { GlobalInfoContext } from "../../../context/globalInfo";
import cn from "classnames";
import {
  setOverlayControllerPanel,
  setOverlayCreditsSettingsDrawerOpen,
} from "../../../store/preferencesSlice";
import ToolbarButton from "./ToolbarButton";
import Outlines from "./Outlines";
import { useGenerateCreditsFromOverlays } from "../../../hooks/useGenerateCreditsFromOverlays";

export type ToolbarOverlayProps = {
  isEditMode: boolean;
  quickLinksDrawerOpen: boolean;
  onQuickLinksOpenChange: (open: boolean) => void;
};

/**
 * Overlay controller toolbar: outline + Quick Links or Generate Credits, then Overlays | Credits Editor | Service Times.
 * Generate-credits hook runs only when this subtree is mounted (overlay controller), not on the main controller.
 */
const ToolbarOverlay = ({
  isEditMode,
  quickLinksDrawerOpen,
  onQuickLinksOpenChange,
}: ToolbarOverlayProps) => {
  const { access } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();
  const overlayControllerPanel = useSelector(
    (state) => state.undoable.present.preferences.overlayControllerPanel,
  );
  const generateCredits = useGenerateCreditsFromOverlays();

  return (
    <>
      <div className="flex min-h-9 min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 scrollbar-variable">
        <Outlines matchToolbarTabs className="min-w-0 shrink" />
        {access === "full" && overlayControllerPanel === "overlays" && (
          <ToolbarButton
            svg={RectangleEllipsis}
            onClick={() => onQuickLinksOpenChange(true)}
            isActive={quickLinksDrawerOpen}
          >
            Quick Links
          </ToolbarButton>
        )}
        {access !== "view" && overlayControllerPanel === "credits" && (
          <div className="flex shrink-0 items-center gap-1">
            <ToolbarButton
              svg={generateCredits.justGenerated ? Check : RefreshCcw}
              onClick={() => generateCredits.generateFromOverlays()}
              disabled={
                !generateCredits.hasOverlays || generateCredits.isGenerating
              }
              isActive={generateCredits.justGenerated}
            >
              {generateCredits.isGenerating
                ? "Generating..."
                : generateCredits.justGenerated
                  ? "Generated."
                  : "Generate Credits"}
            </ToolbarButton>
            <ToolbarButton
              svg={Settings}
              onClick={() =>
                dispatch(setOverlayCreditsSettingsDrawerOpen(true))
              }
              aria-label="Credits settings"
            >
              Settings
            </ToolbarButton>
          </div>
        )}
      </div>
      <hr className="sticky left-0 w-full border-t-2 border-gray-500" />
      <div
        className={cn(
          "flex w-full flex-1 items-center gap-0 overflow-x-auto px-2 py-1 scrollbar-variable",
          isEditMode && "hidden",
        )}
      >
        <ToolbarButton
          svg={Layers}
          onClick={() => dispatch(setOverlayControllerPanel("overlays"))}
          isActive={overlayControllerPanel === "overlays"}
        >
          Overlays
        </ToolbarButton>
        {access !== "view" && (
          <ToolbarButton
            svg={ScrollText}
            onClick={() => dispatch(setOverlayControllerPanel("credits"))}
            isActive={overlayControllerPanel === "credits"}
          >
            Credits Editor
          </ToolbarButton>
        )}
        {access !== "view" && (
          <ToolbarButton
            svg={Clock}
            onClick={() => dispatch(setOverlayControllerPanel("serviceTimes"))}
            isActive={overlayControllerPanel === "serviceTimes"}
          >
            Service Times
          </ToolbarButton>
        )}
      </div>
    </>
  );
};

export default ToolbarOverlay;
