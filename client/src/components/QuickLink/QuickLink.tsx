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
        } else {
          dispatch(
            updateStream({
              slide: null,
              type: "clear",
              name: "",
            })
          );
        }

        if (presentationInfo.bibleDisplayInfo) {
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
    <li className="flex flex-col hover:bg-gray-500 cursor-pointer rounded items-center p-0 border-2 border-gray-500 h-fit">
      <Button onClick={handleClick} variant="none" padding="p-0" className="w-full h-fit flex-col">
        {presentationInfo && (
          <DisplayWindow
            boxes={presentationInfo.slide?.boxes || []}
            className="w-full"
            displayType={displayType}
            participantOverlayInfo={presentationInfo.participantOverlayInfo}
            stbOverlayInfo={presentationInfo.stbOverlayInfo}
            qrCodeOverlayInfo={presentationInfo.qrCodeOverlayInfo}
            imageOverlayInfo={presentationInfo.imageOverlayInfo}
            prevBibleDisplayInfo={presentationInfo.bibleDisplayInfo}
            bibleDisplayInfo={presentationInfo.bibleDisplayInfo}
            formattedTextDisplayInfo={presentationInfo.formattedTextDisplayInfo}
            timerInfo={timerInfo}
          />
        )}
        <p className="text-center text-[0.5rem] font-semibold whitespace-break-spaces w-full overflow-hidden text-ellipsis">
          {label}
        </p>
      </Button>
    </li>
  );
};

export default QuickLink;
