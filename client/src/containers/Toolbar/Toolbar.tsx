import { isControllerWorkspacePath } from "../../utils/controllerWorkspace";
import { useLocation } from "react-router-dom";
import {
  Settings,
  MonitorCog,
  RectangleEllipsis,
  Pencil,
  MonitorPlay,
} from "lucide-react";
import Menu from "./ToolbarElements/Menu";
import ToolbarOverlay from "./ToolbarElements/ToolbarOverlay";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import ItemEditTools from "./ToolbarElements/ItemEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import ToolbarButton from "./ToolbarElements/ToolbarButton";
import { useDispatch, useSelector } from "../../hooks";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Drawer from "../../components/Drawer/Drawer";
import QuickLinksPage from "../../pages/Controller/QuickLinks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import cn from "classnames";
import FormattedTextEditor from "./ToolbarElements/FormattedTextEditor";
import AllToolsDrawer from "./ToolbarElements/AllToolsDrawer";
import {
  type ControllerConfigurationRoute,
  setLastControllerConfigurationRoute,
  setToolbarSection,
} from "../../store/preferencesSlice";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { GlobalInfoContext } from "../../context/globalInfo";
import BoxEditor from "./ToolbarElements/BoxEditor";
import {
  updateArrangements,
  updateBibleInfo,
  updateSlides,
} from "../../store/itemSlice";
import { ItemState } from "../../types";
import { getActiveItemSlides } from "../../utils/activeItemSlides";
import type { ItemMutationOwner } from "../../store/deferredItemMutations";
import { scrollToolbarTabIntoViewIfNeeded } from "../../utils/scrollToolbarTabIntoView";
import { isViewOnlyAccess } from "../../utils/accessTiers";
import { useControllerBasePath } from "../../context/activeController";
import { usePresentationControllerMode } from "../../context/presentationControllerMode";
import MediaSurfaceDiagnostics from "./ToolbarElements/MediaSurfaceDiagnostics";

type sections =
  | "configurations"
  | "editing";

/**
 * "aux" is the presentation toolbar on an auxiliary controller. Same slide /
 * box / item tools and configurations as the main controller, but config links
 * stay under that controller's base path so the operator is not thrown onto
 * `/controller`. Stream Format stays main-only. Outline
 * picking stays in the left service panel — do not duplicate it here.
 */
export type ToolbarVariant = "default" | "overlay" | "aux";

/** Canonical `/controller/...` keys used for remembering the last config tab. */
const getControllerConfigurationRoute = (
  pathname: string,
): ControllerConfigurationRoute | null => {
  if (pathname.includes("quick-links")) {
    return "/controller/quick-links";
  }
  if (pathname.includes("displays") || pathname.includes("monitor-settings")) {
    return "/controller/displays";
  }
  if (pathname.includes("preferences")) {
    return "/controller/preferences";
  }
  return null;
};

/** Remap a remembered `/controller/...` route onto the active controller path. */
const scopeConfigurationRoute = (
  route: ControllerConfigurationRoute | string,
  basePath: string,
) => {
  if (route.startsWith("/controller")) {
    return `${basePath}${route.slice("/controller".length)}`;
  }
  return route;
};

const Toolbar = ({
  className,
  variant = "default",
}: {
  className: string;
  variant?: ToolbarVariant;
}) => {
  const location = useLocation();
  const controllerBasePath = useControllerBasePath();
  /** Quick Links drawer (overlay controller only; state unused when variant is default). */
  const [quickLinksDrawerOpen, setQuickLinksDrawerOpen] = useState(false);
  const { isLyricsEditorOpen, type: itemType } = useSelector(
    (state) => state.undoable.present.item
  );
  const lastControllerConfigurationRoute = useSelector(
    (state) =>
      state.undoable.present.preferences.lastControllerConfigurationRoute,
  );
  const [section, setSection] = useState<sections>("configurations");
  const [allToolsOpen, setAllToolsOpen] = useState(false);
  const { isMobile = false } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();
  const { mode, setMode } = usePresentationControllerMode();

  useEffect(() => {
    if (variant === "overlay" && mode === "present") {
      setQuickLinksDrawerOpen(false);
    }
  }, [mode, variant]);

  const configurationsSubTabRefs = useRef<{
    preferences: HTMLButtonElement | HTMLAnchorElement | null;
    quickLinks: HTMLButtonElement | HTMLAnchorElement | null;
    displays: HTMLButtonElement | HTMLAnchorElement | null;
  }>({
    preferences: null,
    quickLinks: null,
    displays: null,
  });

  const updateItem = useCallback(
    (updatedItem: ItemState, expectedOwner?: ItemMutationOwner) => {
      if (updatedItem.type === "song") {
        dispatch(updateArrangements({ arrangements: updatedItem.arrangements, expectedOwner }));
      } else {
        dispatch(
          updateSlides({
            slides: getActiveItemSlides(updatedItem),
            formattedSections: updatedItem.formattedSections,
            expectedOwner,
          })
        );
      }
      if (updatedItem.bibleInfo) {
        dispatch(updateBibleInfo({ bibleInfo: updatedItem.bibleInfo, expectedOwner }));
      }
    },
    [dispatch]
  );
  // Tools belong to the active Redux item at either controller workspace.
  const onItemPage = useMemo(
    () => isControllerWorkspacePath(location.pathname),
    [location.pathname]
  );
  const canShowSlideAndBoxTools = useMemo(
    () =>
      access === "full" ||
      (access === "music" &&
        (itemType === "song" || itemType === "free")),
    [access, itemType]
  );
  const activeControllerConfigurationRoute = useMemo(
    () => getControllerConfigurationRoute(location.pathname),
    [location.pathname],
  );
  const configurationsHomePath = scopeConfigurationRoute(
    (lastControllerConfigurationRoute as string) === "/controller/service-planning"
      ? "/controller/preferences"
      : lastControllerConfigurationRoute,
    controllerBasePath,
  );
  const showStreamFormat = variant !== "aux";

  useEffect(() => {
    if (onItemPage) {
      setSection(
        isViewOnlyAccess(access) || !canShowSlideAndBoxTools
          ? "configurations"
          : "editing"
      );
    } else {
      setSection("configurations");
    }
  }, [onItemPage, access, canShowSlideAndBoxTools]);

  useEffect(() => {
    if (
      !onItemPage ||
      mode === "present" ||
      section !== "editing" ||
      isViewOnlyAccess(access) ||
      !canShowSlideAndBoxTools
    ) {
      setAllToolsOpen(false);
    }
  }, [onItemPage, mode, section, access, canShowSlideAndBoxTools]);

  useEffect(() => {
    if (!activeControllerConfigurationRoute) return;
    dispatch(
      setLastControllerConfigurationRoute(activeControllerConfigurationRoute),
    );
  }, [activeControllerConfigurationRoute, dispatch, variant]);

  useEffect(() => {
    // SlideEditor uses the legacy preference to choose its text editing panel.
    // Editing tools now share one toolbar surface, so keep that panel behavior.
    dispatch(setToolbarSection(section === "editing" ? "slide-tools" : section));
  }, [section, dispatch]);

  useLayoutEffect(() => {
    if (section !== "configurations") return;
    const path = location.pathname;
    const subKey = path.includes("quick-links")
        ? "quickLinks"
        : path.includes("displays") || path.includes("monitor-settings")
          ? "displays"
          : "preferences";
    scrollToolbarTabIntoViewIfNeeded(configurationsSubTabRefs.current[subKey]);
  }, [section, location.pathname]);

  const renderConfigurationsButton = () => (
    <div className="flex min-w-max shrink-0 gap-0 overflow-x-auto scrollbar-variable">
        {!isViewOnlyAccess(access) ? (
          <ToolbarButton
            svg={Settings}
            to={configurationsHomePath}
            isActive={section === "configurations"}
            onClick={() => setAllToolsOpen(false)}
          >
            Configurations
          </ToolbarButton>
        ) : (
          <ToolbarButton
            svg={Settings}
            onClick={() => setSection("configurations")}
            isActive={section === "configurations"}
          >
            Configurations
          </ToolbarButton>
        )}
    </div>
  );

  const renderContextualToolbar = () => (
    <div
      className={cn(
        "flex min-h-0 w-full min-w-0 flex-1 items-center px-2",
        "[&_[data-slot=input]]:!h-8 [&_[data-slot=input]]:!min-h-8 [&_[data-slot=select-trigger]]:!h-8 [&_[data-slot=select-trigger]]:!min-h-8",
        isLyricsEditorOpen && "hidden",
      )}
    >
      {section === "configurations" ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-variable">
          {!isViewOnlyAccess(access) && (
            <ToolbarButton
              ref={(el) => {
                configurationsSubTabRefs.current.preferences = el;
              }}
              svg={Settings}
              to={`${controllerBasePath}/preferences`}
              isActive={
                location.pathname.includes("preferences") &&
                !location.pathname.includes("quick-links")
              }
            >
              Preferences
            </ToolbarButton>
          )}
          {access === "full" && (
            <ToolbarButton
              ref={(el) => {
                configurationsSubTabRefs.current.quickLinks = el;
              }}
              svg={RectangleEllipsis}
              isActive={location.pathname.includes("quick-links")}
              to={`${controllerBasePath}/quick-links`}
            >
              Quick Links
            </ToolbarButton>
          )}
          {access === "full" && (
            <ToolbarButton
              ref={(el) => {
                configurationsSubTabRefs.current.displays = el;
              }}
              svg={MonitorCog}
              to={`${controllerBasePath}/displays`}
              isActive={
                location.pathname.includes("displays") ||
                location.pathname.includes("monitor-settings")
              }
            >
              Displays
            </ToolbarButton>
          )}
          <MediaSurfaceDiagnostics />
        </div>
      ) : onItemPage && !isViewOnlyAccess(access) && canShowSlideAndBoxTools ? (
        <AllToolsDrawer
          isOpen={allToolsOpen && mode === "edit"}
          onClose={() => setAllToolsOpen(false)}
          onToggle={() => setAllToolsOpen((open) => !open)}
          isMobile={isMobile}
          showBibleMode={itemType === "bible"}
          showStreamFormatting={
            access === "full" && showStreamFormat && itemType === "free"
          }
          showOutputTargets={access === "full"}
        >
          {(targets) => (
            <>
              <SlideEditTools
                quickFontSizeTarget={targets.quickFontSize}
                quickBrightnessTarget={targets.quickBrightness}
                quickBibleModeTarget={targets.quickBibleMode}
                drawerTarget={targets.slideFormatting}
              />
              <BoxEditor
                updateItem={updateItem}
                quickBoxLayoutTarget={targets.quickBoxLayout}
                quickBoxHeightTarget={targets.quickBoxHeight}
                drawerTarget={targets.boxLayout}
              />
              {access === "full" && showStreamFormat && itemType === "free" && (
                <FormattedTextEditor drawerTarget={targets.streamFormatting} />
              )}
              {access === "full" && (
                <ItemEditTools drawerTarget={targets.outputTargets} />
              )}
            </>
          )}
        </AllToolsDrawer>
      ) : null}
    </div>
  );

  const modeToggle = (
    <div
      className="flex shrink-0 items-center overflow-hidden rounded-md border border-gray-600"
      aria-label="Presentation controller workspace mode"
    >
      {(["present", "edit"] as const).map((option) => (
        <ToolbarButton
          key={option}
          svg={option === "present" ? MonitorPlay : Pencil}
          isActive={mode === option}
          className="rounded-none first:rounded-l-md last:rounded-r-md"
          onClick={() => {
            if (option === "present") setAllToolsOpen(false);
            setMode(option);
          }}
        >
          {option === "present" ? "Present" : "Edit"}
        </ToolbarButton>
      ))}
    </div>
  );

  return (
    <ErrorBoundary>
      {variant !== "overlay" ? (
        <div className={cn(className, "flex items-stretch")}>
          <div className="flex min-w-0 flex-1 flex-col" data-testid="toolbar-left-column">
            <div
              className="flex w-full min-w-0 items-center"
              data-testid="toolbar-primary-row"
            >
              <div
                className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 scrollbar-variable"
                data-testid="toolbar-scroll-controls"
              >
                <div className="sticky left-0 z-10 shrink-0 bg-homepage-canvas">
                  <Menu variant="default" />
                </div>
                {modeToggle}
                {mode === "edit" && !isLyricsEditorOpen && !isViewOnlyAccess(access) && <Undo />}
                {mode === "edit" && renderConfigurationsButton()}
              </div>
            </div>
            {mode === "edit" && (
              <>
                <div className="w-full border-t border-gray-600" />
                {renderContextualToolbar()}
              </>
            )}
          </div>
          <div
            className="ml-auto flex shrink-0 items-center border-l-2 border-gray-500 px-2"
            data-testid="toolbar-user-section"
          >
            <UserSection variant={mode === "present" ? "compact" : "default"} />
          </div>
        </div>
      ) : (
        <div className={cn(className, "flex items-stretch")}>
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              className="flex min-w-0 items-center"
              data-testid="toolbar-primary-row"
            >
              <div
                className="scrollbar-variable flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2"
                data-testid="toolbar-scroll-controls"
              >
                <div className="sticky left-0 z-10 shrink-0 bg-homepage-canvas">
                  <Menu variant="overlay" />
                </div>
                {modeToggle}
                <MediaSurfaceDiagnostics />
                {!isLyricsEditorOpen && !isViewOnlyAccess(access) && <Undo />}
                <ToolbarOverlay
                  toolbarRow={mode === "edit" ? "primary" : "present"}
                  quickLinksDrawerOpen={quickLinksDrawerOpen}
                  onQuickLinksOpenChange={setQuickLinksDrawerOpen}
                />
              </div>
            </div>
            {mode === "edit" && (
              <>
                <div className="w-full border-t border-gray-600" />
                <div
                  className="scrollbar-variable flex min-w-0 items-center gap-1 overflow-x-auto px-2"
                  data-testid="toolbar-secondary-row"
                >
                  <ToolbarOverlay
                    toolbarRow="secondary"
                    quickLinksDrawerOpen={quickLinksDrawerOpen}
                    onQuickLinksOpenChange={setQuickLinksDrawerOpen}
                  />
                </div>
              </>
            )}
          </div>
          <div
            className="ml-auto flex shrink-0 items-center border-l-2 border-gray-500 px-2"
            data-testid="toolbar-user-section"
          >
            <UserSection variant={mode === "present" ? "compact" : "default"} />
          </div>
        </div>
      )}
      {variant === "overlay" && access === "full" && (
        <Drawer
          isOpen={quickLinksDrawerOpen}
          onClose={() => setQuickLinksDrawerOpen(false)}
          title="Quick Links"
          position="right"
          size="lg"
          contentClassName="min-h-0 flex flex-col"
        >
          <QuickLinksPage streamOnly />
        </Drawer>
      )}
    </ErrorBoundary>
  );
};

export default Toolbar;
