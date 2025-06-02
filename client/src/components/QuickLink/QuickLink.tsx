import { useDispatch } from "../../hooks";
import {
  clearMonitor,
  clearProjector,
  clearStream,
  updateProjector,
  updateMonitor,
  updateStream,
  updateBibleDisplayInfo,
  updateParticipantOverlayInfo,
  updateStbOverlayInfo,
  updateImageOverlayInfo,
  updateQrCodeOverlayInfo,
} from "../../store/presentationSlice";
import { QuickLinkType, TimerInfo } from "../../types";
import Button from "../Button/Button";
import "./QuickLink.scss";
import DisplayWindow from "../DisplayWindow/DisplayWindow";
import { useMemo } from "react";

type QuickLinkProps = QuickLinkType & {
  isMobile?: boolean;
  timers: TimerInfo[];
};

const QuickLink = ({
  label,
  presentationInfo,
  displayType,
  action,
  isMobile,
  timers,
}: QuickLinkProps) => {
  const dispatch = useDispatch();

  const timerInfo = useMemo(() => {
    return timers.find((t) => t.id === presentationInfo?.timerId);
  }, [timers, presentationInfo]);

  const handleClick = () => {
    if (action === "clear") {
      if (displayType === "stream") dispatch(clearStream());
      if (displayType === "monitor") dispatch(clearMonitor());
      if (displayType === "projector") dispatch(clearProjector());
    } else if (presentationInfo) {
      if (displayType === "projector") {
        dispatch(updateProjector(presentationInfo));
      } else if (displayType === "monitor") {
        dispatch(updateMonitor(presentationInfo));
      } else if (displayType === "stream") {
        if (presentationInfo.slide) {
          dispatch(updateStream(presentationInfo));
        } else if (presentationInfo.bibleDisplayInfo) {
          dispatch(updateBibleDisplayInfo(presentationInfo.bibleDisplayInfo));
        } else if (presentationInfo.imageOverlayInfo) {
          dispatch(updateImageOverlayInfo(presentationInfo.imageOverlayInfo));
        } else if (presentationInfo.participantOverlayInfo) {
          dispatch(
            updateParticipantOverlayInfo(
              presentationInfo.participantOverlayInfo
            )
          );
        } else if (presentationInfo.stbOverlayInfo) {
          dispatch(updateStbOverlayInfo(presentationInfo.stbOverlayInfo));
        } else if (presentationInfo.qrCodeOverlayInfo) {
          dispatch(updateQrCodeOverlayInfo(presentationInfo.qrCodeOverlayInfo));
        }
      }
    }
  };

  if (!presentationInfo && !action) return null;

  return (
    <li className="quick-link">
      <Button
        onClick={handleClick}
        variant="none"
        padding="p-0"
        className="w-full h-full flex-col"
      >
        {!presentationInfo && (
          <div className="w-[3vw] max-lg:w-[8vw] aspect-video bg-black" />
        )}
        {presentationInfo && (
          <DisplayWindow
            boxes={presentationInfo.slide?.boxes || []}
            width={isMobile ? 9 : 3}
            displayType={displayType}
            participantOverlayInfo={presentationInfo.participantOverlayInfo}
            stbOverlayInfo={presentationInfo.stbOverlayInfo}
            qrCodeOverlayInfo={presentationInfo.qrCodeOverlayInfo}
            imageOverlayInfo={presentationInfo.imageOverlayInfo}
            prevBibleDisplayInfo={presentationInfo.bibleDisplayInfo}
            bibleDisplayInfo={presentationInfo.bibleDisplayInfo}
            timerInfo={timerInfo}
          />
        )}
        <p className="text-center text-xs font-semibold whitespace-break-spaces w-full overflow-hidden text-ellipsis">
          {label}
        </p>
      </Button>
    </li>
  );
};

export default QuickLink;
