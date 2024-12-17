import { useLocation } from "react-router-dom";
import { ReactComponent as OutlinesSVG } from "../../assets/icons/list.svg";
import { ReactComponent as EditSquareSVG } from "../../assets/icons/edit-square.svg";
import Menu from "./ToolbarElements/Menu";
import Services from "./ToolbarElements/Services";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import { useSelector } from "../../hooks";
import { forwardRef, useEffect, useState } from "react";
import Button from "../../components/Button/Button";

type sections = "outlines" | "slide-tools";

const Toolbar = forwardRef<HTMLDivElement, { className: string }>(
  ({ className }, ref) => {
    const location = useLocation();
    const { isEditMode } = useSelector((state) => state.undoable.present.item);

    const [section, setSection] = useState<sections>("outlines");
    const onItemPage = location.pathname.includes("controller/item");

    useEffect(() => {
      if (!location.pathname.includes("controller/item")) {
        setSection("outlines");
      } else {
        setSection("slide-tools");
      }
    }, [location.pathname]);

    return (
      <div ref={ref} className={className}>
        <div className="px-2 py-1 flex gap-1 flex-1 border-r-2 border-slate-500 items-center">
          <Menu />
          {!isEditMode && <Undo />}
        </div>
        <div className="w-full flex flex-col gap-1 h-[4.5rem] min-h-fit">
          <div className="flex gap-1 border-b-2 border-slate-500">
            <Button
              variant="none"
              svg={OutlinesSVG}
              onClick={() => setSection("outlines")}
              className={`text-xs ${section === "outlines" && "bg-slate-800"}`}
            >
              Outlines
            </Button>
            {onItemPage && (
              <Button
                variant="none"
                svg={EditSquareSVG}
                onClick={() => setSection("slide-tools")}
                className={`text-xs ${
                  section === "slide-tools" && "bg-slate-800"
                }`}
              >
                Slide Tools
              </Button>
            )}
          </div>

          <div
            className={`px-2 py-1 flex gap-1 items-center flex-1 ${
              isEditMode ? "hidden" : ""
            }`}
          >
            <Services className={`${section !== "outlines" && "hidden"}`} />
            <SlideEditTools
              className={`${section !== "slide-tools" && "hidden"}`}
            />
          </div>
        </div>
        <div className="px-2 py-1 flex gap-1 items-center flex-1 border-l-2 border-slate-500">
          <UserSection />
        </div>
      </div>
    );
  }
);

export default Toolbar;
