import { useLocation } from "react-router-dom";
import {
  Settings,
  SquarePen,
  MonitorCog,
  RectangleEllipsis,
  Pencil,
  MonitorPlay,
  CalendarDays,
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
import {
  type ControllerConfigurationRoute,
  setLastControllerConfigurationRoute,
  setShouldShowStreamFormat,
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
import { scrollToolbarTabIntoViewIfNeeded } from "../../utils/scrollToolbarTabIntoView";
import { isViewOnlyAccess } from "../../utils/accessTiers";
import { useControllerBasePath } from "../../context/activeController";

type sections =
  | "configurations"
  | "slide-tools"
  | "stream-format"
  | "item-tools"
  | "box-tools";

/**
 * "aux" is the presentation toolbar on an auxiliary controller. Same slide /
 * box / item tools and configurations as the main controller, but config links
 * stay under that controller's base path so the operator is not thrown onto
 * `/controller`. Stream Format and Service Planning stay main-only. Outline
 * picking stays in the left service panel — do not duplicate it here.
 */
export type ToolbarVariant = "default" | "overlay" | "aux";

/** Canonical `/controller/...` keys used for remembering the last config tab. */
const getControllerConfigurationRoute = (
  pathname: string,
): ControllerConfigurationRoute | null => {
  if (pathname.includes("service-planning")) {
    return "/controller/service-planning";
  }
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
  const { isEditMode, type: itemType } = useSelector(
    (state) => state.undoable.present.item
  );
  const lastControllerConfigurationRoute = useSelector(
    (state) =>
      state.undoable.present.preferences.lastControllerConfigurationRoute,
  );
  const [section, setSection] = useState<sections>("configurations");
  const { isMobile = false } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();

  const primaryToolbarTabRefs = useRef<
    Partial<Record<sections, HTMLButtonElement | HTMLAnchorElement | null>>
  >({});

  const configurationsSubTabRefs = useRef<{
    preferences: HTMLButtonElement | HTMLAnchorElement | null;
    quickLinks: HTMLButtonElement | HTMLAnchorElement | null;
    displays: HTMLButtonElement | HTMLAnchorElement | null;
    servicePlanning: HTMLButtonElement | HTMLAnchorElement | null;
  }>({
    preferences: null,
    quickLinks: null,
    displays: null,
    servicePlanning: null,
  });

  const updateItem = useCallback(
    (updatedItem: ItemState) => {
      dispatch(
        updateSlides({
          slides: updatedItem.slides,
          formattedSections: updatedItem.formattedSections,
        })
      );
      if (updatedItem.arrangements.length > 0) {
        dispatch(
          updateArrangements({ arrangements: updatedItem.arrangements })
        );
      }
      if (updatedItem.bibleInfo) {
        dispatch(updateBibleInfo({ bibleInfo: updatedItem.bibleInfo }));
      }
    },
    [dispatch]
  );
  // Matches main and aux item routes (`/controller/item/...`, `/aux-controller/:id/item/...`).
  const onItemPage = useMemo(
    () => /\/item\//.test(location.pathname),
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
    variant === "aux" &&
      lastControllerConfigurationRoute === "/controller/service-planning"
      ? "/controller/preferences"
      : lastControllerConfigurationRoute,
    controllerBasePath,
  );
  const showStreamFormat = variant !== "aux";
  const showServicePlanning = variant !== "aux";

  useEffect(() => {
    if (onItemPage) {
      setSection(
        isViewOnlyAccess(access) || !canShowSlideAndBoxTools
          ? "configurations"
          : "slide-tools"
      );
    } else {
      setSection("configurations");
    }
  }, [onItemPage, access, canShowSlideAndBoxTools]);

  // Timer controls live under Slide Tools; always surface them when opening a timer.
  useEffect(() => {
    if (
      !onItemPage ||
      itemType !== "timer" ||
      isViewOnlyAccess(access) ||
      !canShowSlideAndBoxTools
    ) {
      return;
    }
    setSection("slide-tools");
  }, [
    onItemPage,
    itemType,
    access,
    canShowSlideAndBoxTools,
    location.pathname,
  ]);

  useEffect(() => {
    if (!activeControllerConfigurationRoute) return;
    // Prefer displays over a remembered service-planning tab when that tab is
    // hidden on aux — otherwise Configurations would navigate nowhere useful.
    if (
      variant === "aux" &&
      activeControllerConfigurationRoute === "/controller/service-planning"
    ) {
      return;
    }
    dispatch(
      setLastControllerConfigurationRoute(activeControllerConfigurationRoute),
    );
  }, [activeControllerConfigurationRoute, dispatch, variant]);

  useEffect(() => {
    dispatch(setToolbarSection(section));
    if (section === "stream-format") {
      dispatch(setShouldShowStreamFormat(true));
    } else {
      dispatch(setShouldShowStreamFormat(false));
    }
  }, [section, dispatch]);

  useLayoutEffect(() => {
    scrollToolbarTabIntoViewIfNeeded(primaryToolbarTabRefs.current[section]);
  }, [section]);

  useLayoutEffect(() => {
    if (section !== "configurations") return;
    const path = location.pathname;
    const subKey = path.includes("service-planning")
      ? "servicePlanning"
      : path.includes("quick-links")
        ? "quickLinks"
        : path.includes("displays") || path.includes("monitor-settings")
          ? "displays"
          : "preferences";
    scrollToolbarTabIntoViewIfNeeded(configurationsSubTabRefs.current[subKey]);
  }, [section, location.pathname]);

  const renderPresentationTools = () => (
    <>
      <div className="flex gap-0 overflow-x-auto w-full scrollbar-variable">
        {!isViewOnlyAccess(access) ? (
          <ToolbarButton
            ref={(el) => {
              primaryToolbarTabRefs.current.configurations = el;
            }}
            svg={Settings}
            to={configurationsHomePath}
            isActive={section === "configurations"}
          >
            Configurations
          </ToolbarButton>
        ) : (
          <ToolbarButton
            ref={(el) => {
              primaryToolbarTabRefs.current.configurations = el;
            }}
            svg={Settings}
            onClick={() => setSection("configurations")}
            isActive={section === "configurations"}
          >
            Configurations
          </ToolbarButton>
        )}
        <ToolbarButton
          ref={(el) => {
            primaryToolbarTabRefs.current["slide-tools"] = el;
          }}
          svg={SquarePen}
          onClick={() => setSection("slide-tools")}
          hidden={!onItemPage || isViewOnlyAccess(access) || !canShowSlideAndBoxTools}
          isActive={section === "slide-tools"}
        >
          Slide Tools
        </ToolbarButton>
        <ToolbarButton
          ref={(el) => {
            primaryToolbarTabRefs.current["box-tools"] = el;
          }}
          svg={Pencil}
          onClick={() => setSection("box-tools")}
          hidden={!onItemPage || isViewOnlyAccess(access) || !canShowSlideAndBoxTools}
          isActive={section === "box-tools"}
        >
          Box Tools
        </ToolbarButton>
        {access === "full" && (
          <>
            {showStreamFormat && (
              <ToolbarButton
                ref={(el) => {
                  primaryToolbarTabRefs.current["stream-format"] = el;
                }}
                svg={MonitorPlay}
                onClick={() => setSection("stream-format")}
                hidden={!onItemPage}
                isActive={section === "stream-format"}
              >
                Stream Format
              </ToolbarButton>
            )}
            <ToolbarButton
              ref={(el) => {
                primaryToolbarTabRefs.current["item-tools"] = el;
              }}
              svg={SquarePen}
              onClick={() => setSection("item-tools")}
              hidden={!onItemPage}
              isActive={section === "item-tools"}
            >
              Item Tools
            </ToolbarButton>
          </>
        )}
      </div>
      <hr className="border-gray-500 w-full border-t-2 sticky left-0" />
      <div
        className={cn(
          "px-2 py-1 flex items-center flex-1 overflow-x-auto w-full scrollbar-variable",
          isEditMode && "hidden"
        )}
      >
        {!isViewOnlyAccess(access) && (
          <ToolbarButton
            ref={(el) => {
              configurationsSubTabRefs.current.preferences = el;
            }}
            svg={Settings}
            to={`${controllerBasePath}/preferences`}
            hidden={section !== "configurations"}
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
            hidden={section !== "configurations"}
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
            hidden={section !== "configurations"}
            isActive={
              location.pathname.includes("displays") ||
              location.pathname.includes("monitor-settings")
            }
          >
            Displays
          </ToolbarButton>
        )}
        {access === "full" && showServicePlanning && (
          <ToolbarButton
            ref={(el) => {
              configurationsSubTabRefs.current.servicePlanning = el;
            }}
            svg={CalendarDays}
            to={`${controllerBasePath}/service-planning`}
            hidden={section !== "configurations"}
            isActive={location.pathname.includes("service-planning")}
          >
            Service Planning
          </ToolbarButton>
        )}
        <SlideEditTools
          className={cn(section !== "slide-tools" && "hidden")}
        />
        {showStreamFormat && (
          <FormattedTextEditor
            className={cn(section !== "stream-format" && "hidden")}
          />
        )}
        <ItemEditTools
          className={cn(section !== "item-tools" && "hidden")}
        />
        <BoxEditor
          className={cn(section !== "box-tools" && "hidden")}
          updateItem={updateItem}
          isMobile={isMobile}
        />
      </div>
    </>
  );

  return (
    <ErrorBoundary>
      <div className={className}>
        <div className="px-2 py-1 flex gap-2 border-r-2 border-gray-500 items-center flex-col justify-center">
          <Menu variant={variant === "overlay" ? "overlay" : "default"} />
          {!isEditMode && !isViewOnlyAccess(access) && <Undo />}
        </div>
        <div
          className={cn(
            "scrollbar-variable flex-1 flex min-h-fit flex-col min-w-0",
            isEditMode && "invisible"
          )}
        >
          {variant === "overlay" ? (
            <ToolbarOverlay
              isEditMode={!!isEditMode}
              quickLinksDrawerOpen={quickLinksDrawerOpen}
              onQuickLinksOpenChange={setQuickLinksDrawerOpen}
            />
          ) : (
            renderPresentationTools()
          )}
        </div>
        <div className="px-2 py-1 flex gap-1 items-center border-l-2 border-gray-500">
          <UserSection />
        </div>
      </div>
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
