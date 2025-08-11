import { ReactComponent as DoneAllSVG } from "../../../assets/icons/done-all.svg";
import { ReactComponent as CloseSVG } from "../../../assets/icons/close.svg";
import Button from "../../../components/Button/Button";
import { useDispatch, useSelector } from "../../../hooks";
import { OverlayInfo, Presentation } from "../../../types";
import {
  setSelectedQuickLink,
  setSelectedQuickLinkPresentation,
} from "../../../store/preferencesSlice";
import { useMemo } from "react";

interface QuickLinkSelectionProps {
  isMobile?: boolean;
}

const QuickLinkSelection = ({ isMobile }: QuickLinkSelectionProps) => {
  const dispatch = useDispatch();
  const { selectedQuickLink } = useSelector(
    (state) => state.undoable.present.preferences
  );
  const { type, selectedSlide, slides, name, timerInfo } = useSelector(
    (state) => state.undoable.present.item
  );
  const { selectedId, list: overlaysList } = useSelector(
    (state) => state.undoable.present.overlays
  );
  const selectedOverlay = useMemo(
    () => overlaysList.find((overlay) => overlay.id === selectedId),
    [overlaysList, selectedId]
  );

  if (!selectedQuickLink) return null;

  if (selectedQuickLink.linkType === "slide") {
    return (
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
    );
  }

  if (selectedQuickLink.linkType === "overlay") {
    return (
      <section className="flex justify-center rounded-l-md rounded-r-md">
        <Button
          variant="cta"
          className="justify-center rounded-r-none"
          disabled={!selectedOverlay?.id}
          svg={DoneAllSVG}
          onClick={() => {
            if (!selectedOverlay) return;
            let presentationInfo: Presentation = {
              name: selectedOverlay.name || selectedOverlay.description || "",
              slide: null,
              type: "overlay",
            };

            const info: OverlayInfo = {
              id: selectedOverlay.id,
              type: selectedOverlay.type,
              duration: selectedOverlay.duration,
            };

            if (selectedOverlay.type === "participant") {
              presentationInfo = {
                ...presentationInfo,
                participantOverlayInfo: {
                  ...info,
                  name: selectedOverlay.name,
                  event: selectedOverlay.event,
                  title: selectedOverlay.title,
                },
              };
            }

            if (selectedOverlay.type === "stick-to-bottom") {
              presentationInfo = {
                ...presentationInfo,
                stbOverlayInfo: {
                  ...info,
                  subHeading: selectedOverlay.subHeading,
                  title: selectedOverlay.title,
                },
              };
            }

            if (selectedOverlay.type === "qr-code") {
              presentationInfo = {
                ...presentationInfo,
                qrCodeOverlayInfo: {
                  ...info,
                  url: selectedOverlay.url,
                  description: selectedOverlay.description,
                  color: selectedOverlay.color,
                },
              };
            }

            if (selectedOverlay.type === "image") {
              presentationInfo = {
                ...presentationInfo,
                imageOverlayInfo: {
                  ...info,
                  imageUrl: selectedOverlay.imageUrl,
                },
              };
            }

            dispatch(setSelectedQuickLinkPresentation(presentationInfo));
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
    );
  }

  return null;
};

export default QuickLinkSelection;
