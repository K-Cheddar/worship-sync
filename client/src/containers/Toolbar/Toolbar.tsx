import { useLocation } from "react-router-dom";
import {
  Settings,
  SquarePen,
  Monitor,
  RectangleEllipsis,
  Pencil,
  MonitorPlay
} from "lucide-react";
import Menu from "./ToolbarElements/Menu";
import Outlines from "./ToolbarElements/Outlines";
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
import Button from "../../components/Button/Button";
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
  const [quickLinksDrawerOpen, setQuickLinksDrawerOpen] = useState(false);
  const { isEditMode } = useSelector(
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

  useEffect(() => {
    if (onItemPage) {
      setSection("slide-tools");
    } else {
      setSection("settings");
    }
  }, [onItemPage]);

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
          {!isEditMode && !isPhone && <Undo />}
        </div>
        <div
          className={cn(
            "scrollbar-variable flex-1 flex min-h-fit flex-col min-w-0",
            isEditMode && "invisible"
          )}
        >
          <div className="flex gap-1 overflow-x-auto w-full scrollbar-variable">
            <ToolbarButton
              svg={Settings}
              onClick={() => setSection("settings")}
              isActive={section === "settings"}
            >
              Settings
            </ToolbarButton>
            <ToolbarButton
              svg={SquarePen}
              onClick={() => setSection("slide-tools")}
              hidden={!onItemPage}
              isActive={section === "slide-tools"}
            >
              Slide Tools
            </ToolbarButton>
            <ToolbarButton
              svg={Pencil}
              onClick={() => setSection("box-tools")}
              hidden={!onItemPage}
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
              "px-2 py-1 flex gap-1 items-center flex-1 overflow-x-auto w-full",
              isEditMode && "hidden"
            )}
          >
            <Outlines className={cn(section !== "settings" && "hidden")} />
            {variant !== "overlay" && (
              <Button
                className={cn(
                  section !== "settings" && "hidden",
                  location.pathname.includes("preferences") &&
                    !location.pathname.includes("quick-links") &&
                    "outline-2 outline-white",
                )}
                variant="tertiary"
                svg={Settings}
                component="link"
                to="/controller/preferences"
              >
                Preferences
              </Button>
            )}
            <Button
              className={cn(
                section !== "settings" && "hidden",
                (variant === "overlay"
                  ? quickLinksDrawerOpen
                  : location.pathname.includes("quick-links")) &&
                  "outline-2 outline-white",
              )}
              variant="tertiary"
              svg={RectangleEllipsis}
              component={variant === "overlay" ? "button" : "link"}
              to={
                variant === "overlay" ? undefined : "/controller/quick-links"
              }
              onClick={
                variant === "overlay"
                  ? () => setQuickLinksDrawerOpen(true)
                  : undefined
              }
            >
              Quick Links
            </Button>
            {variant !== "overlay" && (
              <Button
                className={cn(
                  section !== "settings" && "hidden",
                  location.pathname.includes("monitor-settings") &&
                    "outline-2 outline-white",
                )}
                variant="tertiary"
                svg={Monitor}
                component="link"
                to="/controller/monitor-settings"
              >
                Monitor Settings
              </Button>
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
        </div>
        <div className="px-2 py-1 flex gap-1 items-center border-l-2 border-gray-500">
          <UserSection />
        </div>
      </div>
      {variant === "overlay" && (
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
