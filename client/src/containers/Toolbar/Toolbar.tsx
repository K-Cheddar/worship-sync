import { Link, useLocation } from "react-router-dom";
import { ReactComponent as SettingsSVG } from "../../assets/icons/settings.svg";
import { ReactComponent as EditSquareSVG } from "../../assets/icons/edit-square.svg";
import { ReactComponent as DoneAllSVG } from "../../assets/icons/done-all.svg";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import Menu from "./ToolbarElements/Menu";
import Outlines from "./ToolbarElements/Outlines";
import SlideEditTools from "./ToolbarElements/SlideEditTools";
import Undo from "./ToolbarElements/Undo";
import UserSection from "./ToolbarElements/UserSection";
import { useSelector, useDispatch } from "../../hooks";
import { forwardRef, useContext, useEffect, useMemo, useState } from "react";
import Button from "../../components/Button/Button";
import { ReactComponent as TimerSVG } from "../../assets/icons/timer.svg";
import TimerControls from "../../components/TimerControls/TimerControls";
import { ControllerInfoContext } from "../../context/controllerInfo";
import {
  setSelectedQuickLink,
  setSelectedQuickLinkPresentation,
} from "../../store/preferencesSlice";
import { OverlayInfo, Presentation } from "../../types";

type sections = "settings" | "slide-tools" | "timer-manager";

const Toolbar = forwardRef<HTMLDivElement, { className: string }>(
  ({ className }, ref) => {
    const location = useLocation();
    const dispatch = useDispatch();

    const { isEditMode, type, selectedSlide, slides, name, timerInfo } =
      useSelector((state) => state.undoable.present.item);

    const { selectedQuickLink } = useSelector(
      (state) => state.undoable.present.preferences
    );

    const overlayInfo = useSelector((state) => state.undoable.present.overlays);

    const [section, setSection] = useState<sections>("settings");

    const { isMobile } = useContext(ControllerInfoContext) || {};

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
              className={`text-xs rounded-none ${
                section === "slide-tools" && "bg-gray-800"
              }`}
            >
              Slide Tools
            </Button>
            <Button
              variant="none"
              svg={TimerSVG}
              disabled={!onItemPage || type !== "timer"}
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
            <Outlines className={`${section !== "settings" && "hidden"}`} />
            <Button
              className={`${section !== "settings" && "hidden"}`}
              variant="none"
              svg={SettingsSVG}
            >
              <Link className="h-full w-full" to="/controller/preferences">
                Preferences
              </Link>
            </Button>
            {selectedQuickLink && selectedQuickLink.linkType === "slide" && (
              <section className="flex justify-center rounded-l-md rounded-r-md mr-2">
                <Button
                  variant="cta"
                  className="justify-center rounded-r-none"
                  disabled={!slides?.[selectedSlide]}
                  svg={DoneAllSVG}
                  onClick={() => {
                    let title = "";
                    let text = "";

                    if (type === "bible") {
                      title =
                        selectedSlide > 0
                          ? slides[selectedSlide].boxes[2]?.words || ""
                          : slides[selectedSlide].boxes[1]?.words || "";
                      text =
                        selectedSlide > 0
                          ? slides[selectedSlide].boxes[1]?.words || ""
                          : "";
                    }

                    dispatch(
                      setSelectedQuickLinkPresentation({
                        name,
                        slide: slides[selectedSlide],
                        type: "slide",
                        timerId: timerInfo?.id,
                        bibleDisplayInfo: {
                          title,
                          text,
                        },
                      })
                    );
                  }}
                >
                  {isMobile ? "Select" : "Select Slide"}
                </Button>
                <Button
                  variant="secondary"
                  className="justify-center rounded-l-none"
                  svg={CloseSVG}
                  onClick={() => {
                    dispatch(setSelectedQuickLink(""));
                  }}
                >
                  {isMobile ? "" : "Cancel Selection"}
                </Button>
              </section>
            )}
            {selectedQuickLink && selectedQuickLink.linkType === "overlay" && (
              <section className="flex justify-center rounded-l-md rounded-r-md">
                <Button
                  variant="cta"
                  className="justify-center rounded-r-none"
                  disabled={!overlayInfo?.id}
                  svg={DoneAllSVG}
                  onClick={() => {
                    let presentationInfo: Presentation = {
                      name: overlayInfo.name || overlayInfo.description || "",
                      slide: null,
                      type: "overlay",
                    };

                    const info: OverlayInfo = {
                      id: overlayInfo.id,
                      type: overlayInfo.type,
                      duration: overlayInfo.duration,
                    };

                    if (overlayInfo.type === "participant") {
                      presentationInfo = {
                        ...presentationInfo,
                        participantOverlayInfo: {
                          ...info,
                          name: overlayInfo.name,
                          event: overlayInfo.event,
                          title: overlayInfo.title,
                        },
                      };
                    }

                    if (overlayInfo.type === "stick-to-bottom") {
                      presentationInfo = {
                        ...presentationInfo,
                        stbOverlayInfo: {
                          ...info,
                          subHeading: overlayInfo.subHeading,
                          title: overlayInfo.title,
                        },
                      };
                    }

                    if (overlayInfo.type === "qr-code") {
                      presentationInfo = {
                        ...presentationInfo,
                        qrCodeOverlayInfo: {
                          ...info,
                          url: overlayInfo.url,
                          description: overlayInfo.description,
                          color: overlayInfo.color,
                        },
                      };
                    }

                    if (overlayInfo.type === "image") {
                      presentationInfo = {
                        ...presentationInfo,
                        imageOverlayInfo: {
                          ...info,
                          imageUrl: overlayInfo.imageUrl,
                        },
                      };
                    }

                    dispatch(
                      setSelectedQuickLinkPresentation(presentationInfo)
                    );
                  }}
                >
                  {isMobile ? "Select" : "Select Overlay"}
                </Button>
                <Button
                  variant="secondary"
                  className="justify-center rounded-l-none"
                  svg={CloseSVG}
                  onClick={() => {
                    dispatch(setSelectedQuickLink(""));
                  }}
                >
                  {isMobile ? "" : "Cancel Selection"}
                </Button>
              </section>
            )}
            <SlideEditTools
              className={`${section !== "slide-tools" && "hidden"}`}
            />
            <TimerControls
              className={`${
                (section !== "timer-manager" || type !== "timer") && "hidden"
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
