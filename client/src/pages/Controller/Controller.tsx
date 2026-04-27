// import { Resizable } from "re-resizable";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import EditorButtons from "../../containers/PanelButtons/PanelButtons";
import Media from "../../containers/Media/Media";
import ServiceItems from "../../containers/ServiceItems/ServiceItems";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";

import LyricsEditor from "../../containers/ItemEditor/LyricsEditor";

import { useContext, useEffect, useRef, useState } from "react";
import Overlays from "../../containers/Overlays/Overlays";
import Bible from "../../containers/Bible/Bible";
import { useDispatch, useSelector } from "../../hooks";
import Songs from "../../containers/Songs/Songs";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ControllerInfoContext } from "../../context/controllerInfo";
import Item from "./Item";
import CreateItem from "../../containers/CreateItem/CreateItem";
import FreeForms from "../../containers/FreeForms/FreeForms";
import Timers from "../../containers/Timers/Timers";
import Preferences from "./Preferences";
import QuickLinks from "./QuickLinks";
import MonitorSettings from "./MonitorSettings";
import Button from "../../components/Button/Button";
import { GlobalInfoContext } from "../../context/globalInfo";
import { setIsEditMode } from "../../store/itemSlice";
import cn from "classnames";
import { RootState } from "../../store/store";
import { useControllerPageLifecycle } from "./useControllerPageLifecycle";
import ControllerPageShell from "../../components/ControllerPageShell/ControllerPageShell";
import ControllerViewRouteGuard from "../../components/ControllerViewRouteGuard/ControllerViewRouteGuard";
import ServicePlanningImportPanel from "./ServicePlanningImportPanel";
import { sidePanelInteractionShouldRemainOpen } from "../../utils/sidePanelDismiss";
import { useServicePlanningSyncRunner } from "./useServicePlanningSyncRunner";
import ServicePlanningSyncFloatingWindow from "./ServicePlanningSyncFloatingWindow";

const Controller = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { layoutRef } = useControllerPageLifecycle();
  useServicePlanningSyncRunner();

  const { dbProgress, connectionStatus } =
    useContext(ControllerInfoContext) || {};

  const { user, churchName } = useContext(GlobalInfoContext) || {};

  const isEditMode = useSelector(
    (state: RootState) => state.undoable.present.item.isEditMode
  );
  const scrollbarWidth = useSelector(
    (state) => state.undoable.present.preferences.scrollbarWidth
  );
  const { access } = useContext(GlobalInfoContext) || {};

  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      location.pathname === "/controller" ||
      location.pathname === "/controller/"
    ) {
      setIsLeftPanelOpen(true);
    }
    if (!location.pathname.includes("/controller/item")) {
      dispatch(setIsEditMode(false));
    }
  }, [location.pathname, dispatch]);

  const handleElementClick = (element: React.MouseEvent) => {
    if (
      !sidePanelInteractionShouldRemainOpen(leftPanelRef, element) &&
      isLeftPanelOpen
    ) {
      setIsLeftPanelOpen(false);
    }

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
      onRootClick={handleElementClick}
      layoutRef={layoutRef}
    >
      <ServicePlanningSyncFloatingWindow />
      {(access === "full" || access === "music") && <LyricsEditor />}
      <Button
        className={cn("lg:hidden mr-2 h-1/4 z-10", isEditMode && "hidden")}
        svg={isLeftPanelOpen ? ArrowLeftFromLine : ArrowRightFromLine}
        onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
      />
      <div
        className={`flex flex-col border-r-2 border-gray-500 bg-homepage-canvas h-full lg:w-[15%] max-lg:absolute max-lg:left-0 transition-all ${isLeftPanelOpen ? "w-[60%] max-lg:z-10" : "w-0 max-lg:z-[-1]"
          }`}
        ref={leftPanelRef}
      >
        <Button
          className="lg:hidden text-sm mb-2 justify-center"
          svg={isLeftPanelOpen ? ArrowLeftFromLine : ArrowRightFromLine}
          onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
        >
          Close Panel
        </Button>
        <EditorButtons access={access} />
        <ServiceItems />
      </div>
      <div className="relative flex h-full min-h-0 w-[60%] flex-1 flex-col overflow-hidden">
        <ControllerViewRouteGuard>
          <Routes>
            <Route
              path="/"
              element={
                <h2 className="text-2xl text-center mt-4 font-bold">
                  No Item Selected
                </h2>
              }
            />
            <Route path="/item/:itemId/:listId" element={<Item />} />
            <Route path="overlays" element={<Overlays />} />
            <Route path="bible" element={<Bible />} />
            <Route path="songs" element={<Songs />} />
            <Route path="free" element={<FreeForms />} />
            <Route path="timers" element={<Timers />} />
            <Route path="create" element={<CreateItem />} />
            <Route path="preferences" element={<Preferences />} />
            <Route path="account" element={<Navigate to="/account" replace />} />
            <Route path="quick-links" element={<QuickLinks />} />
            <Route path="monitor-settings" element={<MonitorSettings />} />
            <Route path="service-planning" element={<ServicePlanningImportPanel />} />
          </Routes>
        </ControllerViewRouteGuard>
      </div>

      {access === "full" && (
        <>
          <Button
            className={cn(
              "lg:hidden text-sm ml-2 justify-center h-1/4 z-10",
              isEditMode && "hidden"
            )}
            svg={isRightPanelOpen ? ArrowRightFromLine : ArrowLeftFromLine}
            onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
          />
          <div
            className={`flex flex-col h-full lg:w-[25%] bg-homepage-canvas border-gray-500 transition-all border-l-2 max-lg:right-0 max-lg:absolute ${isRightPanelOpen ? "w-[65%] max-lg:z-10" : "w-0 max-lg:z-[-1]"
              }`}
            ref={rightPanelRef}
          >
            <Button
              className="lg:hidden text-sm mb-2 justify-center"
              svg={
                isRightPanelOpen ? ArrowRightFromLine : ArrowLeftFromLine
              }
              onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
            >
              Close Panel
            </Button>
            <TransmitHandler maxQuickLinks={4} />
            <Media />
          </div>
        </>
      )}
    </ControllerPageShell>
  );
};

export default Controller;
