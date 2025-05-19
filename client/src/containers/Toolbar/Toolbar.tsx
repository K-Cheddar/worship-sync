import { useLocation } from "react-router-dom";
import { ReactComponent as SettingsSVG } from "../../assets/icons/settings.svg";
import { ReactComponent as EditSquareSVG } from "../../assets/icons/edit-square.svg";
import Menu from "./ToolbarElements/Menu";
import Outlines from "./ToolbarElements/Outlines";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import { useSelector } from "../../hooks";
import { forwardRef, useEffect, useMemo, useState } from "react";
import Button from "../../components/Button/Button";
import { ReactComponent as TimerSVG } from "../../assets/icons/timer.svg";
import TimerControls from "../../components/TimerControls/TimerControls";
type sections = "outlines" | "slide-tools" | "timer-manager";

const Toolbar = forwardRef<HTMLDivElement, { className: string }>(
  ({ className }, ref) => {
    const location = useLocation();
    const { isEditMode, type } = useSelector(
      (state) => state.undoable.present.item
    );
    const { shouldShowItemEditor, shouldShowTimerControls } = useSelector(
      (state) => state.preferences
    );

    const [section, setSection] = useState<sections>("outlines");
    const onItemPage = useMemo(
      () => location.pathname.includes("controller/item"),
      [location.pathname]
    );

    useEffect(() => {
      if (onItemPage && shouldShowTimerControls && type === "timer") {
        setSection("timer-manager");
      } else if (onItemPage && shouldShowItemEditor) {
        setSection("slide-tools");
      } else {
        setSection("outlines");
      }
    }, [onItemPage, shouldShowItemEditor, shouldShowTimerControls, type]);

    return (
      <div ref={ref} className={className}>
        <div className="px-2 py-1 flex gap-1 flex-1 border-r-2 border-gray-500 items-center">
          <Menu />
          {!isEditMode && <Undo />}
        </div>
        <div className="w-full flex h-[3.75rem] min-h-fit flex-col">
          <div className="flex gap-1 border-b-2 border-gray-500">
            <Button
              variant="none"
              svg={SettingsSVG}
              onClick={() => setSection("outlines")}
              className={`text-xs rounded-none ${
                section === "outlines" && "bg-gray-800"
              }`}
            >
              Settings
            </Button>
            <Button
              variant="none"
              disabled={!onItemPage || !shouldShowItemEditor}
              svg={EditSquareSVG}
              onClick={() => setSection("slide-tools")}
              className={`text-xs rounded-none ${
                section === "slide-tools" && "bg-gray-800"
              }`}
            >
              Slide Tools
            </Button>
            <Button
              variant="none"
              svg={TimerSVG}
              disabled={
                !onItemPage || !shouldShowTimerControls || type !== "timer"
              }
              onClick={() => setSection("timer-manager")}
              className={`text-xs rounded-none ${
                section === "timer-manager" && "bg-gray-800"
              }`}
            >
              Timer Manager
            </Button>
          </div>

          <div
            className={`px-2 py-1 flex gap-1 items-center flex-1 ${
              isEditMode ? "hidden" : ""
            }`}
          >
            <Outlines className={`${section !== "outlines" && "hidden"}`} />
            <SlideEditTools
              className={`${
                (section !== "slide-tools" || !shouldShowItemEditor) && "hidden"
              }`}
            />
            <TimerControls
              className={`${
                (section !== "timer-manager" ||
                  !shouldShowTimerControls ||
                  type !== "timer") &&
                "hidden"
              }`}
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
