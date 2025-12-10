import { useLocation } from "react-router-dom";
import { ReactComponent as SettingsSVG } from "../../assets/icons/settings.svg";
import { ReactComponent as EditSquareSVG } from "../../assets/icons/edit-square.svg";
import { ReactComponent as TimerSVG } from "../../assets/icons/timer.svg";
import { ReactComponent as ListSVG } from "../../assets/icons/list.svg";
import { ReactComponent as MonitorSVG } from "../../assets/icons/desktop_1.svg";
import Menu from "./ToolbarElements/Menu";
import Outlines from "./ToolbarElements/Outlines";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import ItemEditTools from "./ToolbarElements/ItemEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import QuickLinkSelection from "./ToolbarElements/QuickLinkSelection";
import ToolbarButton from "./ToolbarElements/ToolbarButton";
import { useDispatch, useSelector } from "../../hooks";
import { useContext, useEffect, useMemo, useState } from "react";
import Button from "../../components/Button/Button";
import TimerControls from "../../components/TimerControls/TimerControls";
import { ControllerInfoContext } from "../../context/controllerInfo";
import cn from "classnames";
import "./ToolbarElements/Toolbar.scss";
import FormattedTextEditor from "./ToolbarElements/FormattedTextEditor";
import { setShouldShowStreamFormat } from "../../store/preferencesSlice";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { GlobalInfoContext } from "../../context/globalInfo";

type sections =
  | "settings"
  | "slide-tools"
  | "timer-manager"
  | "stream-format"
  | "item-tools";

const Toolbar = ({ className }: { className: string }) => {
  const location = useLocation();
  const { isEditMode, type } = useSelector(
    (state) => state.undoable.present.item
  );
  const [section, setSection] = useState<sections>("settings");
  const { isMobile, isPhone } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};

  const dispatch = useDispatch();
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
        <div className={cn("toolbar-middle", isEditMode && "invisible")}>
          <div className="flex gap-1 overflow-x-auto w-full">
            <ToolbarButton
              svg={SettingsSVG}
              onClick={() => setSection("settings")}
              isActive={section === "settings"}
            >
              Settings
            </ToolbarButton>
            <ToolbarButton
              svg={EditSquareSVG}
              onClick={() => setSection("slide-tools")}
              disabled={!onItemPage}
              hidden={!onItemPage}
              isActive={section === "slide-tools"}
            >
              Slide Tools
            </ToolbarButton>
            {access === "full" && (
              <>
                <ToolbarButton
                  svg={EditSquareSVG}
                  onClick={() => setSection("stream-format")}
                  disabled={!onItemPage}
                  hidden={!onItemPage}
                  isActive={section === "stream-format"}
                >
                  Stream Format
                </ToolbarButton>
                <ToolbarButton
                  svg={TimerSVG}
                  onClick={() => setSection("timer-manager")}
                  disabled={!onItemPage || type !== "timer"}
                  hidden={!onItemPage}
                  isActive={section === "timer-manager"}
                >
                  Timer Manager
                </ToolbarButton>
                <ToolbarButton
                  svg={EditSquareSVG}
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
                  "outline outline-2 outline-white"
              )}
              variant="tertiary"
              svg={SettingsSVG}
              component="link"
              to="/controller/preferences"
            >
              Preferences
            </Button>
            <Button
              className={cn(
                section !== "settings" && "hidden",
                location.pathname.includes("quick-links") &&
                  "outline outline-2 outline-white"
              )}
              variant="tertiary"
              svg={ListSVG}
              component="link"
              to="/controller/quick-links"
            >
              Quick Links
            </Button>
            <Button
              className={cn(
                section !== "settings" && "hidden",
                location.pathname.includes("monitor-settings") &&
                  "outline outline-2 outline-white"
              )}
              variant="tertiary"
              svg={MonitorSVG}
              component="link"
              to="/controller/monitor-settings"
            >
              Monitor Settings
            </Button>
            <QuickLinkSelection isMobile={isMobile} />
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
