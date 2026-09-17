import { useContext, useLayoutEffect, useRef } from "react";
import {
  RectangleEllipsis,
  Layers,
  MessageSquare,
  PanelsTopLeft,
  ScrollText,
  Clock,
  Columns3,
  Check,
  RefreshCcw,
  Settings,
  MonitorCog,
} from "lucide-react";
import { useDispatch, useSelector } from "../../../hooks";
import { GlobalInfoContext } from "../../../context/globalInfo";
import {
  setOverlayControllerPanel,
  setOverlayCreditsSettingsDrawerOpen,
} from "../../../store/preferencesSlice";
import { setServicePlanningFloatingWindowDismissed } from "../../../store/servicePlanningImportSlice";
import ToolbarButton from "./ToolbarButton";
import Outlines from "./Outlines";
import { useGenerateCreditsFromOverlays } from "../../../hooks/useGenerateCreditsFromOverlays";
import { scrollToolbarTabIntoViewIfNeeded } from "../../../utils/scrollToolbarTabIntoView";
import GeneratedCreditsFloatingWindow from "../../../pages/CreditsEditor/GeneratedCreditsFloatingWindow";
import { isViewOnlyAccess } from "../../../utils/accessTiers";
import { usePresentationControllerMode } from "../../../context/presentationControllerMode";
export type ToolbarOverlayProps = {
  quickLinksDrawerOpen: boolean;
  onQuickLinksOpenChange: (open: boolean) => void;
  toolbarRow?: "present" | "primary" | "secondary";
};

const CreditsToolbarControls = () => {
  const { access } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();
  const generateCredits = useGenerateCreditsFromOverlays();

  if (isViewOnlyAccess(access) || access === "music") return null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <ToolbarButton
        svg={generateCredits.justGenerated ? Check : RefreshCcw}
        onClick={() => generateCredits.generateFromOverlays()}
        disabled={!generateCredits.hasOverlays || generateCredits.isGenerating}
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
        onClick={() => dispatch(setOverlayCreditsSettingsDrawerOpen(true))}
        aria-label="Credits settings"
      >
        Settings
      </ToolbarButton>
    </div>
  );
};

/**
 * Overlay controller toolbar: outline + Quick Links or Generate Credits, then Overlays | Credits Editor | Service Times.
 * Generate-credits hook runs only when this subtree is mounted (overlay controller), not on the main controller.
 */
const ToolbarOverlay = ({
  quickLinksDrawerOpen,
  onQuickLinksOpenChange,
  toolbarRow = "present",
}: ToolbarOverlayProps) => {
  const { access } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();
  const { mode } = usePresentationControllerMode();
  const isEditMode = mode === "edit";
  const showPrimaryRow = toolbarRow === "present" || toolbarRow === "primary";
  const showSecondaryRow = toolbarRow === "present" || toolbarRow === "secondary";

  const overlayControllerPanel = useSelector(
    (state) => state.undoable.present.preferences.overlayControllerPanel,
  );

  const serviceOutline = useSelector(
    (state) => state.servicePlanningImport?.serviceOutline,
  );

  const overlayPanelTabRefs = useRef<{
    overlays: HTMLButtonElement | HTMLAnchorElement | null;
    boardPosts: HTMLButtonElement | HTMLAnchorElement | null;
    overlaysAndPosts: HTMLButtonElement | HTMLAnchorElement | null;
    credits: HTMLButtonElement | HTMLAnchorElement | null;
    serviceTimes: HTMLButtonElement | HTMLAnchorElement | null;
    displays: HTMLButtonElement | HTMLAnchorElement | null;
  }>({
    overlays: null,
    boardPosts: null,
    overlaysAndPosts: null,
    credits: null,
    serviceTimes: null,
    displays: null,
  });

  useLayoutEffect(() => {
    scrollToolbarTabIntoViewIfNeeded(
      overlayPanelTabRefs.current[overlayControllerPanel],
    );
  }, [overlayControllerPanel]);

  return (
    <>
      {showPrimaryRow && <Outlines matchToolbarTabs className="shrink-0" />}

      {showSecondaryRow && isEditMode &&
        access === "full" && (
          <ToolbarButton
            svg={RectangleEllipsis}
            onClick={() => onQuickLinksOpenChange(true)}
            isActive={quickLinksDrawerOpen}
          >
            Quick Links
          </ToolbarButton>
        )}
      {showSecondaryRow && isEditMode && access === "full" && (
        <ToolbarButton
          ref={(el) => {
            overlayPanelTabRefs.current.displays = el;
          }}
          svg={MonitorCog}
          onClick={() => dispatch(setOverlayControllerPanel("displays"))}
          isActive={overlayControllerPanel === "displays"}
        >
          Displays
        </ToolbarButton>
      )}
      {showSecondaryRow && isEditMode && overlayControllerPanel === "credits" && (
        <CreditsToolbarControls />
      )}
      {showPrimaryRow && <GeneratedCreditsFloatingWindow />}
      {showPrimaryRow && <ToolbarButton
        ref={(el) => {
          overlayPanelTabRefs.current.overlays = el;
        }}
        svg={Layers}
        onClick={() => dispatch(setOverlayControllerPanel("overlays"))}
        isActive={overlayControllerPanel === "overlays"}
      >
        Overlays
      </ToolbarButton>}
      {showPrimaryRow && access === "full" && (
        <>
          <ToolbarButton
            ref={(el) => {
              overlayPanelTabRefs.current.boardPosts = el;
            }}
            svg={MessageSquare}
            onClick={() => dispatch(setOverlayControllerPanel("boardPosts"))}
            isActive={overlayControllerPanel === "boardPosts"}
          >
            Board Posts
          </ToolbarButton>
          <ToolbarButton
            ref={(el) => {
              overlayPanelTabRefs.current.overlaysAndPosts = el;
            }}
            className="hidden xl:flex"
            svg={Columns3}
            onClick={() => dispatch(setOverlayControllerPanel("overlaysAndPosts"))}
            isActive={overlayControllerPanel === "overlaysAndPosts"}
          >
            Overlays &amp; Posts
          </ToolbarButton>
        </>
      )}
      {showPrimaryRow && !isViewOnlyAccess(access) && access !== "music" && (
        <ToolbarButton
          ref={(el) => {
            overlayPanelTabRefs.current.credits = el;
          }}
          svg={ScrollText}
          onClick={() => dispatch(setOverlayControllerPanel("credits"))}
          isActive={overlayControllerPanel === "credits"}
        >
          Credits Editor
        </ToolbarButton>
      )}
      {showPrimaryRow && !isViewOnlyAccess(access) && (
        <ToolbarButton
          ref={(el) => {
            overlayPanelTabRefs.current.serviceTimes = el;
          }}
          svg={Clock}
          onClick={() => dispatch(setOverlayControllerPanel("serviceTimes"))}
          isActive={overlayControllerPanel === "serviceTimes"}
        >
          Service Times
        </ToolbarButton>
      )}
      {showPrimaryRow && <ToolbarButton
        svg={PanelsTopLeft}
        disabled={!serviceOutline}
        onClick={() => dispatch(setServicePlanningFloatingWindowDismissed(false))}
        aria-label="Open service plan"
      >
        Open Service Plan
      </ToolbarButton>}
    </>
  );
};

export default ToolbarOverlay;
