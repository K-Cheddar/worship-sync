import { useContext, useEffect, useRef, useState } from "react";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";
import Media from "../../containers/Media/Media";
import Overlays from "../../containers/Overlays/Overlays";
import BoardStreamPanel from "./BoardStreamPanel";
import Button from "../../components/Button/Button";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import { setIsEditMode } from "../../store/itemSlice";
import { setOverlayControllerPanel } from "../../store/preferencesSlice";
import { useControllerPageLifecycle } from "../Controller/useControllerPageLifecycle";
import cn from "classnames";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import ControllerPageShell from "../../components/ControllerPageShell/ControllerPageShell";
import CreditsEditor from "../CreditsEditor/CreditsEditor";
import ServiceTimes from "../../containers/ServiceTimes/ServiceTimes";
import OverlayDisplaysPanel from "./OverlayDisplaysPanel";
import { sidePanelInteractionShouldRemainOpen } from "../../utils/sidePanelDismiss";
import ServicePlanningSyncFloatingWindow from "../Controller/ServicePlanningSyncFloatingWindow";
import OverlaysAndPostsWorkspace from "./OverlaysAndPostsWorkspace";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { isViewOnlyAccess } from "../../utils/accessTiers";

const OverlayController = () => {
  const dispatch = useDispatch();
  const { layoutRef } = useControllerPageLifecycle();
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);

  const { dbProgress, connectionStatus } =
    useContext(ControllerInfoContext) || {};
  const { user, churchName, access } = useContext(GlobalInfoContext) || {};
  const { scrollbarWidth } = useSelector(
    (state) => state.undoable.present.preferences,
  );
  const overlayControllerPanel = useSelector(
    (state) => state.undoable.present.preferences.overlayControllerPanel,
  );
  const isXlUp = useMediaQuery("(min-width: 1280px)");
  const isCombinedWorkspace =
    overlayControllerPanel === "overlaysAndPosts" && isXlUp;
  const showOverlaysPanel =
    overlayControllerPanel === "overlays" ||
    (overlayControllerPanel === "overlaysAndPosts" && !isXlUp);
  const showPresentationPanel =
    overlayControllerPanel === "overlays" ||
    overlayControllerPanel === "boardPosts" ||
    overlayControllerPanel === "overlaysAndPosts";
  useEffect(() => {
    dispatch(setIsEditMode(false));
  }, [dispatch]);

  useEffect(() => {
    if (overlayControllerPanel === "overlaysAndPosts" && !isXlUp) {
      dispatch(setOverlayControllerPanel("overlays"));
    }
  }, [dispatch, isXlUp, overlayControllerPanel]);

  useEffect(() => {
    return () => {
      dispatch(setOverlayControllerPanel("overlays"));
    };
  }, [dispatch]);

  const handleElementClick = (element: React.MouseEvent) => {
    if (
      !sidePanelInteractionShouldRemainOpen(rightPanelRef, element) &&
      isRightPanelOpen
    ) {
      setIsRightPanelOpen(false);
    }
  };

  return (
    <ControllerPageShell
      user={user}
      churchName={churchName}
      dbProgress={dbProgress}
      connectionStatus={connectionStatus}
      scrollbarWidth={scrollbarWidth}
      toolbarVariant="overlay"
      onRootClick={handleElementClick}
      layoutRef={layoutRef}
    >
      {/*
        Stacked absolute layers share one box.
        Do not use `hidden` (display:none) on the inactive panel: descendants are not laid out,
        so credits TextArea autoResize (scrollHeight) stays ~0 until focus forces a reflow.
        Inactive panel: opacity-0 + pointer-events-none + z-0; active: z-10 + opacity-100.
      */}
      <div className="relative flex flex-3 min-h-0 h-full min-w-0 self-stretch overflow-hidden">
        {!isCombinedWorkspace && (
          <div
            className={cn(
              "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden transition-none",
              showOverlaysPanel
                ? "z-10 opacity-100"
                : "pointer-events-none z-0 opacity-0",
            )}
            aria-hidden={!showOverlaysPanel}
          >
            <Overlays />
          </div>
        )}
        {access === "full" && !isCombinedWorkspace && (
          <div
            className={cn(
              "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden transition-none",
              overlayControllerPanel === "boardPosts"
                ? "z-10 opacity-100"
                : "pointer-events-none z-0 opacity-0",
            )}
            aria-hidden={overlayControllerPanel !== "boardPosts"}
          >
            <BoardStreamPanel />
          </div>
        )}
        {access === "full" && isCombinedWorkspace && (
          <div className="absolute inset-0 z-10 flex min-h-0 min-w-0 overflow-hidden">
            <OverlaysAndPostsWorkspace />
          </div>
        )}
        {!isViewOnlyAccess(access) && (
          <div
            className={cn(
              "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden transition-none",
              overlayControllerPanel === "credits"
                ? "z-10 opacity-100"
                : "pointer-events-none z-0 opacity-0",
            )}
            aria-hidden={overlayControllerPanel !== "credits"}
          >
            <CreditsEditor embeddedInOverlayController />
          </div>
        )}
        {!isViewOnlyAccess(access) && (
          <div
            className={cn(
              "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden transition-none",
              overlayControllerPanel === "serviceTimes"
                ? "z-10 opacity-100"
                : "pointer-events-none z-0 opacity-0",
            )}
            aria-hidden={overlayControllerPanel !== "serviceTimes"}
          >
            <ServiceTimes />
          </div>
        )}
        {!isViewOnlyAccess(access) && (
          <div
            className={cn(
              "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden transition-none",
              overlayControllerPanel === "displays"
                ? "z-10 opacity-100"
                : "pointer-events-none z-0 opacity-0",
            )}
            aria-hidden={overlayControllerPanel !== "displays"}
          >
            {/* Mounted only while selected, unlike the other panels: this one
                fetches the church's paired screens, and a hidden tab should not
                make that request on every overlay controller load. */}
            {overlayControllerPanel === "displays" && <OverlayDisplaysPanel />}
          </div>
        )}
      </div>
      {access === "full" && (
        <>
          <Button
            className={cn(
              "z-10 ml-2 h-1/4 justify-center text-sm lg:hidden",
              !showPresentationPanel && "hidden",
            )}
            svg={isRightPanelOpen ? ArrowRightFromLine : ArrowLeftFromLine}
            onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
          />
          <div
            className={cn(
              "flex flex-col flex-2 h-full bg-homepage-canvas border-gray-500 transition-all border-l-2",
              isCombinedWorkspace
                ? "xl:flex-[0_0_25%] xl:w-1/4 xl:min-w-0"
                : "lg:w-[min(46rem,46%)] lg:min-w-120",
              "shrink-0",
              "max-lg:right-0 max-lg:absolute",
              isRightPanelOpen ? "w-[65%] max-lg:z-10" : "w-0 max-lg:z-[-1]",
              !showPresentationPanel && "hidden",
            )}
            ref={rightPanelRef}
          >
            <Button
              className="lg:hidden text-sm mb-2 justify-center"
              svg={isRightPanelOpen ? ArrowRightFromLine : ArrowLeftFromLine}
              onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
            >
              Close Panel
            </Button>
            <div className="flex flex-col flex-1 min-h-0 h-full max-h-full overflow-hidden overflow-x-auto">
              <TransmitHandler
                visibleScreens={["stream"]}
                previewScale={1.875}
                fillWidth={isCombinedWorkspace}
                variant="overlayStreamFocus"
                showStreamOverlayOnlyToggle
                showClearStreamOverlaysButton
              />
              <Media variant="panel" pageMode="overlayController" />
            </div>
          </div>
        </>
      )}
      {access === "music" && (
        <div
          className={cn(
            "flex h-full shrink-0 flex-col border-l-2 border-gray-500 bg-homepage-canvas lg:w-[min(46rem,46%)] lg:min-w-120",
            !showPresentationPanel && "hidden",
          )}
        >
          <TransmitHandler
            visibleScreens={["stream"]}
            previewScale={1.875}
            variant="overlayStreamFocus"
            showStreamOverlayOnlyToggle
            showClearStreamOverlaysButton
          />
        </div>
      )}
      <ServicePlanningSyncFloatingWindow hideOutlineActions />
    </ControllerPageShell>
  );
};

export default OverlayController;
