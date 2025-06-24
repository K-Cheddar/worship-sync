import { Link, useLocation } from "react-router-dom";
import { ReactComponent as SettingsSVG } from "../../assets/icons/settings.svg";
import { ReactComponent as EditSquareSVG } from "../../assets/icons/edit-square.svg";
import { ReactComponent as TimerSVG } from "../../assets/icons/timer.svg";
import Menu from "./ToolbarElements/Menu";
import Outlines from "./ToolbarElements/Outlines";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import QuickLinkSelection from "./ToolbarElements/QuickLinkSelection";
import { useDispatch, useSelector } from "../../hooks";
import { forwardRef, useContext, useEffect, useMemo, useState } from "react";
import Button from "../../components/Button/Button";
import TimerControls from "../../components/TimerControls/TimerControls";
import { ControllerInfoContext } from "../../context/controllerInfo";
import cn from "classnames";
import "./ToolbarElements/Toolbar.scss";
import FormattedTextEditor from "./ToolbarElements/FormattedTextEditor";
import { setShouldShowStreamFormat } from "../../store/preferencesSlice";

type sections = "settings" | "slide-tools" | "timer-manager" | "stream-format";

const Toolbar = forwardRef<HTMLDivElement, { className: string }>(
  ({ className }, ref) => {
    const location = useLocation();
    const { isEditMode, type } = useSelector(
      (state) => state.undoable.present.item
    );
    const [section, setSection] = useState<sections>("settings");
    const { isMobile, isPhone } = useContext(ControllerInfoContext) || {};
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
      <div ref={ref} className={className}>
        <div className="px-2 py-1 flex gap-1 flex-1 border-r-2 border-gray-500 items-center">
          <Menu isPhone={isPhone} isEditMode={isEditMode} />
          {!isEditMode && !isPhone && <Undo />}
        </div>
        <div className="toolbar-middle">
          <div className="flex gap-1">
            <Button
              variant="none"
              svg={SettingsSVG}
              onClick={() => setSection("settings")}
              className={`text-xs rounded-none ${
                section === "settings" && "bg-gray-800"
              }`}
            >
              Settings
            </Button>
            <Button
              variant="none"
              disabled={!onItemPage}
              svg={EditSquareSVG}
              onClick={() => setSection("slide-tools")}
              className={cn(
                "text-xs rounded-none",
                section === "slide-tools" && "bg-gray-800",
                !onItemPage && "hidden"
              )}
            >
              Slide Tools
            </Button>
            <Button
              variant="none"
              disabled={!onItemPage}
              svg={EditSquareSVG}
              onClick={() => setSection("stream-format")}
              className={cn(
                "text-xs rounded-none",
                section === "stream-format" && "bg-gray-800",
                !onItemPage && "hidden"
              )}
            >
              Stream Format
            </Button>
            <Button
              variant="none"
              svg={TimerSVG}
              disabled={!onItemPage || type !== "timer"}
              onClick={() => setSection("timer-manager")}
              className={cn(
                "text-xs rounded-none",
                section === "timer-manager" && "bg-gray-800",
                !onItemPage && "hidden"
              )}
            >
              Timer Manager
            </Button>
          </div>
          <hr className="border-gray-500 w-full border-t-2 sticky left-0" />
          <div
            className={cn(
              "px-2 py-1 flex gap-1 items-center flex-1",
              isEditMode && "hidden"
            )}
          >
            <Outlines className={cn(section !== "settings" && "hidden")} />
            <Button
              className={cn(section !== "settings" && "hidden")}
              variant="none"
              svg={SettingsSVG}
            >
              <Link className="h-full w-full" to="/controller/preferences">
                Preferences
              </Link>
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
          </div>
        </div>
        <div className="px-2 py-1 flex gap-1 items-center flex-1 border-l-2 border-gray-500">
          <UserSection />
        </div>
      </div>
    );
  }
);

export default Toolbar;
