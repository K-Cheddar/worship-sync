import { useLocation } from "react-router-dom";
import { ReactComponent as SettingsSVG } from "../../assets/icons/settings.svg";
import { ReactComponent as EditSquareSVG } from "../../assets/icons/edit-square.svg";
import Menu from "./ToolbarElements/Menu";
import Services from "./ToolbarElements/Services";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import { useSelector } from "../../hooks";
import { forwardRef, useEffect, useMemo, useState } from "react";
import Button from "../../components/Button/Button";

type sections = "outlines" | "slide-tools";

const Toolbar = forwardRef<HTMLDivElement, { className: string }>(
  ({ className }, ref) => {
    const location = useLocation();
    const { isEditMode } = useSelector((state) => state.undoable.present.item);
    const { shouldShowItemEditor } = useSelector((state) => state.preferences);

    const [section, setSection] = useState<sections>("outlines");
    const onItemPage = useMemo(
      () => location.pathname.includes("controller/item"),
      [location.pathname]
    );

    useEffect(() => {
      if (onItemPage && shouldShowItemEditor) {
        setSection("slide-tools");
      } else {
        setSection("outlines");
      }
    }, [onItemPage, shouldShowItemEditor]);

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
          </div>

          <div
            className={`px-2 py-1 flex gap-1 items-center flex-1 ${
              isEditMode ? "hidden" : ""
            }`}
          >
            <Services className={`${section !== "outlines" && "hidden"}`} />
            <SlideEditTools
              className={`${
                (section !== "slide-tools" || !shouldShowItemEditor) && "hidden"
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
