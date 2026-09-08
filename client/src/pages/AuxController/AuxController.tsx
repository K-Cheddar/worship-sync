import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import cn from "classnames";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import ControllerPageShell from "../../components/ControllerPageShell/ControllerPageShell";
import ServiceItems from "../../containers/ServiceItems/ServiceItems";
import EditorButtons from "../../containers/PanelButtons/PanelButtons";
import Songs from "../../containers/Songs/Songs";
import Bible from "../../containers/Bible/Bible";
import FreeForms from "../../containers/FreeForms/FreeForms";
import Timers from "../../containers/Timers/Timers";
import CreateItem from "../../containers/CreateItem/CreateItem";
import Item from "../Controller/Item";
import Media from "../../containers/Media/Media";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";
import Button from "../../components/Button/Button";
import MirrorDisplayTile from "../../components/MirrorDisplay/MirrorDisplayTile";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import { setIsEditMode } from "../../store/itemSlice";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { selectControllerProfiles } from "../../store/controllerProfilesSlice";
import { useControllerPageLifecycle } from "../Controller/useControllerPageLifecycle";
import {
  ActiveControllerProvider,
  useControllerBasePath,
  useControllerProfileRegistry,
} from "../../context/activeController";
import {
  findControllerProfile,
  getControllerOutputs,
  isKnownControllerProfile,
} from "../../utils/controllerProfiles";
import { isViewOnlyAccess } from "../../utils/accessTiers";
import { sidePanelInteractionShouldRemainOpen } from "../../utils/sidePanelDismiss";

/**
 * A slim presentation controller for one auxiliary audience screen.
 *
 * It is deliberately not the main controller with pieces hidden. The operator
 * here is driving a second room-facing display with its own content: they need
 * their outline, their slides, their one display, and a way to join the main
 * screen. Songs, Bible, timers, and overlays belong to the service being run in
 * the sanctuary, and putting them here would suggest this controller drives that
 * service too.
 */
const AuxControllerBody = () => {
  const dispatch = useDispatch();
  const { layoutRef } = useControllerPageLifecycle();
  const { profile, profiles } = useControllerProfileRegistry();
  const controllerBasePath = useControllerBasePath();
  // False while the registry is still on its way; the profile is a stand-in
  // that drives nothing, so the page works but cannot reach a screen yet.
  const isProfileKnown = isKnownControllerProfile(profiles, profile);

  const { dbProgress, connectionStatus } =
    useContext(ControllerInfoContext) || {};
  const { user, churchName, access } = useContext(GlobalInfoContext) || {};
  const scrollbarWidth = useSelector(
    (state) => state.undoable.present.preferences.scrollbarWidth,
  );
  const displayOutputs = useSelector(selectDisplayOutputs);

  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);

  /** This controller's own displays, and every other screen of the same kind. */
  const ownedOutputs = useMemo(
    () => getControllerOutputs(profile, displayOutputs),
    [profile, displayOutputs],
  );
  const mirrorSourceIdsByOutput = useMemo(() => {
    const ownedIds = new Set(ownedOutputs.map((output) => output.id));
    return ownedOutputs.reduce<Record<string, string[]>>((acc, output) => {
      acc[output.id] = displayOutputs
        .filter(
          (candidate) =>
            candidate.enabled &&
            candidate.type === output.type &&
            !ownedIds.has(candidate.id),
        )
        .map((candidate) => candidate.id);
      return acc;
    }, {});
  }, [ownedOutputs, displayOutputs]);

  // This controller never edits items in place; editing belongs to the main
  // controller, where the library and its arrangements live.
  useEffect(() => {
    dispatch(setIsEditMode(false));
  }, [dispatch]);

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

  const canDrive = !isViewOnlyAccess(access);

  return (
    <ControllerPageShell
      user={user}
      churchName={churchName}
      dbProgress={dbProgress}
      connectionStatus={connectionStatus}
      scrollbarWidth={scrollbarWidth}
      toolbarVariant="aux"
      onRootClick={handleElementClick}
      layoutRef={layoutRef}
    >
      <Button
        className="z-10 mr-2 h-1/4 lg:hidden"
        svg={isLeftPanelOpen ? ArrowLeftFromLine : ArrowRightFromLine}
        onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
      />
      <div
        className={cn(
          "flex h-full flex-col border-r-2 border-gray-500 bg-homepage-canvas transition-all lg:w-[20%] max-lg:absolute max-lg:left-0",
          isLeftPanelOpen ? "w-[60%] max-lg:z-10" : "w-0 max-lg:z-[-1]",
        )}
        ref={leftPanelRef}
      >
        <Button
          className="mb-2 justify-center text-sm lg:hidden"
          svg={isLeftPanelOpen ? ArrowLeftFromLine : ArrowRightFromLine}
          onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
        >
          Close Panel
        </Button>
        {/* Custom items first: this controller's content is usually its own,
            but the shared library stays reachable. Overlays are deliberately
            absent — they belong to the stream. */}
        <EditorButtons
          access={access}
          basePath={controllerBasePath}
          sections={["free", "create", "songs", "bible", "timers"]}
        />
        <ServiceItems />
      </div>

      <div className="relative flex h-full min-h-0 w-[60%] flex-1 flex-col overflow-hidden">
        {!isProfileKnown && (
          <p className="border-b-2 border-gray-500 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Still loading this controller&rsquo;s settings, so it cannot send to
            a display yet. Your outline and slides are available.
          </p>
        )}
        {canDrive && ownedOutputs.length > 0 && (
          <div className="flex flex-col gap-2 border-b-2 border-gray-500 px-3 py-2">
            {ownedOutputs.map((output) => (
              <MirrorDisplayTile
                key={output.id}
                outputId={output.id}
                sourceOutputIds={mirrorSourceIdsByOutput[output.id] ?? []}
              />
            ))}
          </div>
        )}
        {/* Same nested item route as the main controller, under this
            controller's own path. Outline links are relative, so they resolve
            here rather than navigating the operator onto /controller. */}
        <Routes>
          <Route
            path="/"
            element={
              <h2 className="mt-4 text-center text-2xl font-bold">
                No Item Selected
              </h2>
            }
          />
          <Route path="item/:itemId/:listId" element={<Item />} />
          <Route path="free" element={<FreeForms />} />
          <Route path="create" element={<CreateItem />} />
          <Route path="songs" element={<Songs />} />
          <Route path="bible" element={<Bible />} />
          <Route path="timers" element={<Timers />} />
        </Routes>
      </div>

      {canDrive && (
        <>
          <Button
            className="z-10 ml-2 h-1/4 justify-center text-sm lg:hidden"
            svg={isRightPanelOpen ? ArrowRightFromLine : ArrowLeftFromLine}
            onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
          />
          <div
            className={cn(
              "flex h-full flex-col border-l-2 border-gray-500 bg-homepage-canvas transition-all lg:w-[25%] max-lg:absolute max-lg:right-0",
              isRightPanelOpen ? "w-[65%] max-lg:z-10" : "w-0 max-lg:z-[-1]",
            )}
            ref={rightPanelRef}
          >
            <Button
              className="mb-2 justify-center text-sm lg:hidden"
              svg={isRightPanelOpen ? ArrowRightFromLine : ArrowLeftFromLine}
              onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
            >
              Close Panel
            </Button>
            <TransmitHandler maxQuickLinks={4} />
            <Media variant="panel" />
          </div>
        </>
      )}
    </ControllerPageShell>
  );
};

/** Shown when the church's controller list has loaded and this one is not in it. */
const AuxControllerUnavailable = ({ profileId }: { profileId: string }) => (
  <div className="dark flex h-dvh w-dvw flex-col items-center justify-center gap-3 bg-homepage-canvas p-6 text-center text-white">
    <h1 className="text-xl font-bold">This controller is not available</h1>
    <p className="max-w-prose text-sm text-gray-300">
      It may have been retired or removed. An administrator can check the list
      under Account &rsaquo; Controllers.
    </p>
    <p className="font-mono text-xs text-gray-500">{profileId}</p>
    <Link
      to="/home"
      className="text-sm text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
    >
      Back to home
    </Link>
  </div>
);

/**
 * Route entry.
 *
 * The controller's identity is in the URL, so the page renders straight away.
 * It does not wait on the church-wide controller registry: blocking the whole
 * surface on that fetch left an operator watching a spinner for settings the
 * page can do without, and never recovered if the fetch never landed.
 *
 * Until the registry arrives the controller stands in as one that drives no
 * displays, so nothing can reach a screen by accident — see
 * `resolveControllerProfile`. Its outlines still load, because the outline
 * scope is the id from the route.
 */
const AuxController = () => {
  const { profileId = "" } = useParams();
  const profiles = useSelector(selectControllerProfiles);
  const isLoaded = useSelector(
    (state) => state.controllerProfiles?.isLoaded ?? false,
  );
  const profile = findControllerProfile(profiles, profileId);

  // Only refuse once the registry has actually spoken.
  if (isLoaded && (!profile?.enabled || profile.type !== "aux-presentation")) {
    return <AuxControllerUnavailable profileId={profileId} />;
  }

  return (
    <ActiveControllerProvider profileId={profileId}>
      <AuxControllerBody />
    </ActiveControllerProvider>
  );
};

export default AuxController;
