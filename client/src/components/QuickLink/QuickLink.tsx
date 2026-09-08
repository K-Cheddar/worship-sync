import { useDispatch, useSelector } from "../../hooks";
import {
  clearOutput,
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
  /** Display this link acts on; the tile that renders it supplies this. */
  outputId?: string;
  timers: TimerInfo[];
  isMobile?: boolean;
};

const QuickLink = ({
  label,
  presentationInfo,
  displayType,
  outputId,
  action,
  timers,
}: QuickLinkProps) => {
  const dispatch = useDispatch();
  const overlaysList = useSelector(
    (state) => state.undoable.present.overlays.list,
  );

  const resolvedPresentation = useMemo(
    () =>
      mergeStoredPresentationWithLiveOverlay(presentationInfo, overlaysList),
    [presentationInfo, overlaysList],
  );

  const timerInfo = useMemo(() => {
    return timers.find((t) => t.id === resolvedPresentation?.timerId);
  }, [timers, resolvedPresentation]);

  const handleClick = () => {
    // A quick link belongs to the tile's display, so both clear and send name
    // it. Untargeted sends would land on the built-in, and the per-surface
    // clears would blank every display of that kind.
    const targets = outputId ? [outputId] : undefined;
    if (action === "clear") {
      if (outputId) dispatch(clearOutput(outputId));
    } else if (resolvedPresentation) {
      if (displayType === "projector") {
        dispatch(
          updateProjector({ ...resolvedPresentation, outputIds: targets }),
        );
      } else if (displayType === "monitor") {
        dispatch(
          updateMonitor({ ...resolvedPresentation, outputIds: targets }),
        );
        if (
          resolvedPresentation.type === "slide" ||
          resolvedPresentation.type === "timer"
        ) {
          dispatch(setMonitorTimerId(resolvedPresentation.timerId || null));
        } else if (resolvedPresentation.type === "service-time") {
          dispatch(setMonitorTimerId(null));
        }
      } else if (displayType === "stream") {
        if (resolvedPresentation.slide) {
          dispatch(
            updateStream({ ...resolvedPresentation, outputIds: targets }),
          );
        }

        if (resolvedPresentation.bibleDisplayInfo) {
          dispatch(
            updateBibleDisplayInfo({
              ...resolvedPresentation.bibleDisplayInfo,
              outputIds: targets,
            }),
          );
        } else if (resolvedPresentation.imageOverlayInfo) {
          dispatch(
            updateImageOverlayInfo({
              ...resolvedPresentation.imageOverlayInfo,
              outputIds: targets,
            }),
          );
        } else if (resolvedPresentation.participantOverlayInfo) {
          dispatch(
            updateParticipantOverlayInfo({
              ...resolvedPresentation.participantOverlayInfo,
              outputIds: targets,
            }),
          );
        } else if (resolvedPresentation.stbOverlayInfo) {
          dispatch(
            updateStbOverlayInfo({
              ...resolvedPresentation.stbOverlayInfo,
              outputIds: targets,
            }),
          );
        } else if (resolvedPresentation.qrCodeOverlayInfo) {
          dispatch(
            updateQrCodeOverlayInfo({
              ...resolvedPresentation.qrCodeOverlayInfo,
              outputIds: targets,
            }),
          );
        }
      }
    }
  };

  if (!presentationInfo && !action) return null;

  return (
    <li className="flex flex-col hover:bg-gray-500 cursor-pointer rounded items-center p-0 border-2 border-gray-500 h-fit">
      <Button
        onClick={handleClick}
        variant="none"
        padding="p-0"
        className="w-full h-fit flex-col"
      >
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
            formattedTextDisplayInfo={
              resolvedPresentation.formattedTextDisplayInfo
            }
            timerInfo={timerInfo}
          />
        )}
        <p
          className="text-center font-semibold whitespace-break-spaces w-full overflow-clip text-ellipsis max-h-10"
          style={{ fontSize: "clamp(0.5rem, 0.6vw, 0.7rem)" }}
        >
          {label}
        </p>
      </Button>
    </li>
  );
};

export default QuickLink;
