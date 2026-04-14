import { useLocation } from "react-router-dom";
import {
  Settings,
  SquarePen,
  Monitor,
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
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import Drawer from "../../components/Drawer/Drawer";
import QuickLinksPage from "../../pages/Controller/QuickLinks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import cn from "classnames";
import FormattedTextEditor from "./ToolbarElements/FormattedTextEditor";
import {
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

type sections =
  | "settings"
  | "slide-tools"
  | "stream-format"
  | "item-tools"
  | "box-tools";

export type ToolbarVariant = "default" | "overlay";

const Toolbar = ({
  className,
  variant = "default",
}: {
  className: string;
  variant?: ToolbarVariant;
}) => {
  const location = useLocation();
  /** Quick Links drawer (overlay controller only; state unused when variant is default). */
  const [quickLinksDrawerOpen, setQuickLinksDrawerOpen] = useState(false);
  const { isEditMode, type: itemType } = useSelector(
    (state) => state.undoable.present.item
  );
  const [section, setSection] = useState<sections>("settings");
  const { isPhone, isMobile = false } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();

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
  const onItemPage = useMemo(
    () => location.pathname.includes("controller/item"),
    [location.pathname]
  );
  const canShowSlideAndBoxTools = useMemo(
    () => access === "full" || (access === "music" && itemType === "song"),
    [access, itemType]
  );

  useEffect(() => {
    if (onItemPage) {
      setSection(
        access === "view" || !canShowSlideAndBoxTools
          ? "settings"
          : "slide-tools"
      );
    } else {
      setSection("settings");
    }
  }, [onItemPage, access, canShowSlideAndBoxTools]);

  useEffect(() => {
    dispatch(setToolbarSection(section));
    if (section === "stream-format") {
      dispatch(setShouldShowStreamFormat(true));
    } else {
      dispatch(setShouldShowStreamFormat(false));
    }
  }, [section, dispatch]);

  return (
    <ErrorBoundary>
      <div className={className}>
        <div className="px-2 py-1 flex gap-1 border-r-2 border-gray-500 items-center">
          <Menu
            isPhone={isPhone}
            isEditMode={isEditMode}
            variant={variant}
          />
          {!isEditMode && !isPhone && access !== "view" && <Undo />}
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
            <>
              <div className="flex gap-0 overflow-x-auto w-full scrollbar-variable">
                {access !== "view" ? (
                  <ToolbarButton
                    svg={Settings}
                    to="/controller/preferences"
                    isActive={section === "settings"}
                  >
                    Settings
                  </ToolbarButton>
                ) : (
                  <ToolbarButton
                    svg={Settings}
                    onClick={() => setSection("settings")}
                    isActive={section === "settings"}
                  >
                    Settings
                  </ToolbarButton>
                )}
                <ToolbarButton
                  svg={SquarePen}
                  onClick={() => setSection("slide-tools")}
                  hidden={!onItemPage || access === "view" || !canShowSlideAndBoxTools}
                  isActive={section === "slide-tools"}
                >
                  Slide Tools
                </ToolbarButton>
                <ToolbarButton
                  svg={Pencil}
                  onClick={() => setSection("box-tools")}
                  hidden={!onItemPage || access === "view" || !canShowSlideAndBoxTools}
                  isActive={section === "box-tools"}
                >
                  Box Tools
                </ToolbarButton>
                {access === "full" && (
                  <>
                    <ToolbarButton
                      svg={MonitorPlay}
                      onClick={() => setSection("stream-format")}
                      hidden={!onItemPage}
                      isActive={section === "stream-format"}
                    >
                      Stream Format
                    </ToolbarButton>
                    <ToolbarButton
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
                  "px-2 py-1 flex items-center flex-1 overflow-x-auto w-full",
                  isEditMode && "hidden"
                )}
              >
                {access !== "view" && (
                  <ToolbarButton
                    svg={Settings}
                    to="/controller/preferences"
                    hidden={section !== "settings"}
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
                    svg={RectangleEllipsis}
                    hidden={section !== "settings"}
                    isActive={location.pathname.includes("quick-links")}
                    to="/controller/quick-links"
                  >
                    Quick Links
                  </ToolbarButton>
                )}
                {access === "full" && (
                  <ToolbarButton
                    svg={Monitor}
                    to="/controller/monitor-settings"
                    hidden={section !== "settings"}
                    isActive={location.pathname.includes("monitor-settings")}
                  >
                    Monitor Settings
                  </ToolbarButton>
                )}
                <SlideEditTools
                  className={cn(section !== "slide-tools" && "hidden")}
                />
                <FormattedTextEditor
                  className={cn(section !== "stream-format" && "hidden")}
                />
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
