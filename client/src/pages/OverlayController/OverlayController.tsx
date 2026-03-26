import { useContext, useEffect, useRef, useState } from "react";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";
import Media from "../../containers/Media/Media";
import Overlays from "../../containers/Overlays/Overlays";
import Button from "../../components/Button/Button";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import { setIsEditMode } from "../../store/itemSlice";
import { useControllerPageLifecycle } from "../Controller/useControllerPageLifecycle";
import cn from "classnames";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import ControllerPageShell from "../../components/ControllerPageShell/ControllerPageShell";

const OverlayController = () => {
  const dispatch = useDispatch();
  const { layoutRef } = useControllerPageLifecycle();
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);

  const { dbProgress, connectionStatus } =
    useContext(ControllerInfoContext) || {};
  const { user, access } = useContext(GlobalInfoContext) || {};
  const { scrollbarWidth } = useSelector(
    (state) => state.undoable.present.preferences
  );
  useEffect(() => {
    dispatch(setIsEditMode(false));
  }, [dispatch]);

  const handleElementClick = (element: React.MouseEvent) => {
    if (
      !rightPanelRef.current?.contains(element.target as Node) &&
      isRightPanelOpen
    ) {
      setIsRightPanelOpen(false);
    }
  };

  return (
    <ControllerPageShell
      user={user}
      dbProgress={dbProgress}
      connectionStatus={connectionStatus}
      scrollbarWidth={scrollbarWidth}
      toolbarVariant="overlay"
      onRootClick={handleElementClick}
      layoutRef={layoutRef}
    >
      <div className="flex flex-3 min-h-0 min-w-0 overflow-hidden">
        <Overlays />
      </div>
      {access === "full" && (
        <>
          <Button
            className="lg:hidden text-sm ml-2 justify-center h-1/4 z-10"
            svg={isRightPanelOpen ? ArrowRightFromLine : ArrowLeftFromLine}
            onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
          />
          <div
            className={cn(
              "flex flex-col flex-2 h-full bg-gray-700 border-gray-500 transition-all border-l-2",
              "lg:w-[min(46rem,46%)] lg:min-w-120 shrink-0",
              "max-lg:right-0 max-lg:absolute",
              isRightPanelOpen ? "w-[65%] max-lg:z-10" : "w-0 max-lg:z-[-1]"
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
                variant="overlayStreamFocus"
                showStreamOverlayOnlyToggle
                showClearStreamOverlaysButton
              />
              <Media variant="panel" pageMode="overlayController" />
            </div>
          </div>
        </>
      )}
      {access !== "full" && (
        <div className="flex flex-col h-full lg:w-[min(46rem,46%)] lg:min-w-120 shrink-0 border-l-2 border-gray-500 bg-gray-700">
          <TransmitHandler
            visibleScreens={["stream"]}
            previewScale={1.875}
            variant="overlayStreamFocus"
            showStreamOverlayOnlyToggle
            showClearStreamOverlaysButton
          />
        </div>
      )}
    </ControllerPageShell>
  );
};

export default OverlayController;
