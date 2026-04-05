import { useDispatch, useSelector } from "../../hooks";
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
import { setMonitorTimerId } from "../../store/preferencesSlice";
import { QuickLinkType, TimerInfo } from "../../types";
import Button from "../Button/Button";
import DisplayWindow from "../DisplayWindow/DisplayWindow";
import { useMemo } from "react";
import { mergeStoredPresentationWithLiveOverlay } from "../../utils/quickLinkOverlayPresentation";

type QuickLinkProps = QuickLinkType & {
  timers: TimerInfo[];
  isMobile?: boolean;
};

const QuickLink = ({
  label,
  presentationInfo,
  displayType,
  action,
  timers,
}: QuickLinkProps) => {
  const dispatch = useDispatch();
  const overlaysList = useSelector(
    (state) => state.undoable.present.overlays.list
  );

  const resolvedPresentation = useMemo(
    () =>
      mergeStoredPresentationWithLiveOverlay(presentationInfo, overlaysList),
    [presentationInfo, overlaysList]
  );

  const timerInfo = useMemo(() => {
    return timers.find((t) => t.id === resolvedPresentation?.timerId);
  }, [timers, resolvedPresentation]);

  const handleClick = () => {
    if (action === "clear") {
      if (displayType === "stream") dispatch(clearStream());
      if (displayType === "monitor") dispatch(clearMonitor());
      if (displayType === "projector") dispatch(clearProjector());
    } else if (resolvedPresentation) {
      if (displayType === "projector") {
        dispatch(updateProjector(resolvedPresentation));
      } else if (displayType === "monitor") {
        dispatch(updateMonitor(resolvedPresentation));
        if (
          resolvedPresentation.type === "slide" ||
          resolvedPresentation.type === "timer"
        ) {
          dispatch(setMonitorTimerId(resolvedPresentation.timerId || null));
        }
      } else if (displayType === "stream") {
        if (resolvedPresentation.slide) {
          dispatch(updateStream(resolvedPresentation));
        }

        if (resolvedPresentation.bibleDisplayInfo) {
          dispatch(
            updateBibleDisplayInfo(resolvedPresentation.bibleDisplayInfo)
          );
        } else if (resolvedPresentation.imageOverlayInfo) {
          dispatch(
            updateImageOverlayInfo(resolvedPresentation.imageOverlayInfo)
          );
        } else if (resolvedPresentation.participantOverlayInfo) {
          dispatch(
            updateParticipantOverlayInfo(
              resolvedPresentation.participantOverlayInfo
            )
          );
        } else if (resolvedPresentation.stbOverlayInfo) {
          dispatch(updateStbOverlayInfo(resolvedPresentation.stbOverlayInfo));
        } else if (resolvedPresentation.qrCodeOverlayInfo) {
          dispatch(
            updateQrCodeOverlayInfo(resolvedPresentation.qrCodeOverlayInfo)
          );
        }
      }
    }
  };

  if (!presentationInfo && !action) return null;

  return (
    <li className="flex flex-col hover:bg-gray-500 cursor-pointer rounded items-center p-0 border-2 border-gray-500 h-fit">
      <Button onClick={handleClick} variant="none" padding="p-0" className="w-full h-fit flex-col">
        {resolvedPresentation && (
          <DisplayWindow
            boxes={resolvedPresentation.slide?.boxes || []}
            className="w-full"
            displayType={displayType}
            participantOverlayInfo={resolvedPresentation.participantOverlayInfo}
            stbOverlayInfo={resolvedPresentation.stbOverlayInfo}
            qrCodeOverlayInfo={resolvedPresentation.qrCodeOverlayInfo}
            imageOverlayInfo={resolvedPresentation.imageOverlayInfo}
            prevBibleDisplayInfo={resolvedPresentation.bibleDisplayInfo}
            bibleDisplayInfo={resolvedPresentation.bibleDisplayInfo}
            formattedTextDisplayInfo={resolvedPresentation.formattedTextDisplayInfo}
            timerInfo={timerInfo}
          />
        )}
        <p
          className="text-center font-semibold whitespace-break-spaces w-full overflow-clip text-ellipsis max-h-10"
          style={{ fontSize: 'clamp(0.5rem, 0.6vw, 0.7rem)' }}
        >
          {label}
        </p>
      </Button>
    </li>
  );
};

export default QuickLink;
