import { useLocation } from "react-router-dom";
import {
  Settings,
  SquarePen,
  Timer,
  Monitor,
  RectangleEllipsis,
  Pencil,
  MonitorPlay,
} from "lucide-react";
import Menu from "./ToolbarElements/Menu";
import Outlines from "./ToolbarElements/Outlines";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import ItemEditTools from "./ToolbarElements/ItemEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import ToolbarButton from "./ToolbarElements/ToolbarButton";
import { useDispatch, useSelector } from "../../hooks";
import { useContext, useEffect, useMemo, useState, useCallback } from "react";
import Button from "../../components/Button/Button";
import TimerControls from "../../components/TimerControls/TimerControls";
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
  | "timer-manager"
  | "stream-format"
  | "item-tools"
  | "box-tools";

const Toolbar = ({ className }: { className: string }) => {
  const location = useLocation();
  const { isEditMode, type } = useSelector(
    (state) => state.undoable.present.item
  );
  const [section, setSection] = useState<sections>("settings");
  const [isElectron, setIsElectron] = useState(false);
  const { isPhone, isMobile = false } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};

  const dispatch = useDispatch();

  useEffect(() => {
    const checkElectron = async () => {
      if (window.electronAPI) {
        const result = await window.electronAPI.isElectron();
        setIsElectron(result);
      }
    };
    checkElectron();
  }, []);

  const updateItem = useCallback(
    (updatedItem: ItemState) => {
      dispatch(updateSlides({ slides: updatedItem.slides }));
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
    if (onItemPage && type === "timer") {
      setSection("timer-manager");
    } else if (onItemPage) {
      setSection("slide-tools");
    } else {
      setSection("settings");
    }
  }, [onItemPage, type]);

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
          <Menu isPhone={isPhone} isEditMode={isEditMode} />
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
              disabled={!onItemPage}
              hidden={!onItemPage}
              isActive={section === "slide-tools"}
            >
              Slide Tools
            </ToolbarButton>
            <ToolbarButton
              svg={Pencil}
              onClick={() => setSection("box-tools")}
              disabled={!onItemPage}
              hidden={!onItemPage}
              isActive={section === "box-tools"}
            >
              Box Tools
            </ToolbarButton>
            {access === "full" && (
              <>
                <ToolbarButton
                  svg={SquarePen}
                  onClick={() => setSection("stream-format")}
                  disabled={!onItemPage}
                  hidden={!onItemPage}
                  isActive={section === "stream-format"}
                >
                  Stream Format
                </ToolbarButton>
                <ToolbarButton
                  svg={Timer}
                  onClick={() => setSection("timer-manager")}
                  disabled={!onItemPage || type !== "timer"}
                  hidden={!onItemPage}
                  isActive={section === "timer-manager"}
                >
                  Timer Manager
                </ToolbarButton>
                <ToolbarButton
                  svg={SquarePen}
                  onClick={() => setSection("item-tools")}
                  disabled={!onItemPage}
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
            <Button
              className={cn(
                section !== "settings" && "hidden",
                location.pathname.includes("preferences") &&
                  !location.pathname.includes("quick-links") &&
                  "outline-2 outline-white"
              )}
              variant="tertiary"
              svg={Settings}
              component="link"
              to="/controller/preferences"
            >
              Preferences
            </Button>
            <Button
              className={cn(
                section !== "settings" && "hidden",
                location.pathname.includes("quick-links") &&
                  "outline-2 outline-white"
              )}
              variant="tertiary"
              svg={RectangleEllipsis}
              component="link"
              to="/controller/quick-links"
            >
              Quick Links
            </Button>
            <Button
              className={cn(
                section !== "settings" && "hidden",
                location.pathname.includes("monitor-settings") &&
                  !location.pathname.includes("monitor-controls") &&
                  "outline-2 outline-white"
              )}
              variant="tertiary"
              svg={Monitor}
              component="link"
              to="/controller/monitor-settings"
            >
              Monitor Settings
            </Button>
            {isElectron && (
              <Button
                className={cn(
                  section !== "settings" && "hidden",
                  location.pathname.includes("monitor-controls") &&
                    "outline-2 outline-white"
                )}
                variant="tertiary"
                svg={MonitorPlay}
                component="link"
                to="/controller/monitor-controls"
              >
                Monitor Controls
              </Button>
            )}
            <SlideEditTools
              className={cn(section !== "slide-tools" && "hidden")}
            />
            <FormattedTextEditor
              className={cn(section !== "stream-format" && "hidden")}
            />
            <TimerControls
              className={cn(
                (section !== "timer-manager" || type !== "timer") && "hidden"
              )}
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
    </ErrorBoundary>
  );
};

export default Toolbar;
