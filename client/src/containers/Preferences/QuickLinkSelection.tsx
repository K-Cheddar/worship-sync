import { CheckCheck, X } from "lucide-react";
import Button from "../../components/Button/Button";
import { useDispatch, useSelector } from "../../hooks";
import { DisplayType, OverlayInfo, Presentation } from "../../types";
import {
  setSelectedQuickLink,
  setSelectedQuickLinkPresentation,
} from "../../store/preferencesSlice";
import { useToast } from "../../context/toastContext";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import { useMemo } from "react";

interface QuickLinkSelectionProps {
  linkType: "slide" | "overlay";
  quickLinkId: string;
  isMobile?: boolean;
  toastId: string;
  displayType?: DisplayType;
}

const QuickLinkSelection = ({
  linkType,
  quickLinkId,
  isMobile,
  toastId,
  displayType = "projector",
}: QuickLinkSelectionProps) => {
  const dispatch = useDispatch();
  const { showToast, removeToast } = useToast();
  const { type, selectedSlide, slides, name, timerInfo } = useSelector(
    (state) => state.undoable.present.item
  );
  const { selectedOverlay } = useSelector(
    (state) => state.undoable.present.overlay
  );

  // Get current slide for preview
  const currentSlide = useMemo(() => {
    if (linkType === "slide" && slides?.[selectedSlide]) {
      return slides[selectedSlide];
    }
    return null;
  }, [linkType, slides, selectedSlide]);

  // Get bible display info for preview
  const bibleDisplayInfo = useMemo(() => {
    if (linkType === "slide" && type === "bible" && currentSlide) {
      const title =
        selectedSlide > 0
          ? currentSlide.boxes[2]?.words || ""
          : currentSlide.boxes[1]?.words || "";
      const text = selectedSlide > 0 ? currentSlide.boxes[1]?.words || "" : "";
      return { title, text };
    }
    return undefined;
  }, [linkType, type, currentSlide, selectedSlide]);

  // Get overlay info for preview
  const overlayInfo = useMemo(() => {
    if (linkType === "overlay" && selectedOverlay) {
      return {
        participantOverlayInfo:
          selectedOverlay.type === "participant"
            ? {
                id: selectedOverlay.id,
                type: selectedOverlay.type,
                duration: selectedOverlay.duration,
                name: selectedOverlay.name,
                event: selectedOverlay.event,
                title: selectedOverlay.title,
              }
            : undefined,
        stbOverlayInfo:
          selectedOverlay.type === "stick-to-bottom"
            ? {
                id: selectedOverlay.id,
                type: selectedOverlay.type,
                duration: selectedOverlay.duration,
                subHeading: selectedOverlay.subHeading,
                title: selectedOverlay.title,
              }
            : undefined,
        qrCodeOverlayInfo:
          selectedOverlay.type === "qr-code"
            ? {
                id: selectedOverlay.id,
                type: selectedOverlay.type,
                duration: selectedOverlay.duration,
                url: selectedOverlay.url,
                description: selectedOverlay.description,
              }
            : undefined,
        imageOverlayInfo:
          selectedOverlay.type === "image"
            ? {
                id: selectedOverlay.id,
                type: selectedOverlay.type,
                duration: selectedOverlay.duration,
                imageUrl: selectedOverlay.imageUrl,
              }
            : undefined,
      };
    }
    return null;
  }, [linkType, selectedOverlay]);

  const handleSlideSelect = () => {
    if (!slides?.[selectedSlide]) return;

    let title = "";
    let text = "";

    if (type === "bible") {
      title =
        selectedSlide > 0
          ? slides[selectedSlide].boxes[2]?.words || ""
          : slides[selectedSlide].boxes[1]?.words || "";
      text =
        selectedSlide > 0 ? slides[selectedSlide].boxes[1]?.words || "" : "";
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
    removeToast(toastId);
    showToast("Slide linked successfully!", "success");
  };

  const handleOverlaySelect = () => {
    if (!selectedOverlay?.id) return;

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
    removeToast(toastId);
    showToast("Overlay linked successfully!", "success");
  };

  const handleCancel = () => {
    dispatch(setSelectedQuickLink(""));
    removeToast(toastId);
  };

  if (linkType === "slide") {
    return (
      <div className="flex flex-col gap-3 mt-2">
        <DisplayWindow
          displayType={displayType}
          showBorder
          width={isMobile ? 20 : 16}
          boxes={currentSlide?.boxes}
          bibleDisplayInfo={bibleDisplayInfo}
          timerInfo={timerInfo}
        />
        <div className="flex gap-2 w-full">
          <Button
            variant="cta"
            className="justify-center flex-1"
            disabled={!slides?.[selectedSlide]}
            svg={CheckCheck}
            onClick={handleSlideSelect}
          >
            {isMobile ? "Select" : "Select Slide"}
          </Button>
          <Button
            variant="secondary"
            className="justify-center flex-1"
            svg={X}
            onClick={handleCancel}
          >
            {isMobile ? "" : "Cancel"}
          </Button>
        </div>
      </div>
    );
  }

  if (linkType === "overlay") {
    return (
      <div className="flex flex-col gap-3 mt-2">
        <DisplayWindow
          displayType={displayType}
          showBorder
          width={isMobile ? 20 : 16}
          participantOverlayInfo={overlayInfo?.participantOverlayInfo}
          stbOverlayInfo={overlayInfo?.stbOverlayInfo}
          qrCodeOverlayInfo={overlayInfo?.qrCodeOverlayInfo}
          imageOverlayInfo={overlayInfo?.imageOverlayInfo}
        />
        <div className="flex gap-2">
          <Button
            variant="cta"
            className="justify-center"
            disabled={!selectedOverlay?.id}
            svg={CheckCheck}
            onClick={handleOverlaySelect}
          >
            {isMobile ? "Select" : "Select Overlay"}
          </Button>
          <Button
            variant="secondary"
            className="justify-center"
            svg={X}
            onClick={handleCancel}
          >
            {isMobile ? "" : "Cancel"}
          </Button>
        </div>
      </div>
    );
  }

  return null;
};

export default QuickLinkSelection;
