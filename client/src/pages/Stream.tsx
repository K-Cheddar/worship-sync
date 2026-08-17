import { useSelector } from "../hooks";
import {
  useOutputForSurface,
  useWindowKeyForSurface,
} from "../hooks/useOutputForSurface";
import { selectOutputSlot } from "../store/presentationSlice";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import { useWakeLock } from "../hooks/useWakeLock";
import { useCloseOnEscape } from "../hooks/useCloseOnEscape";
import { useCallback } from "react";

const Stream = () => {
  const output = useOutputForSurface("stream");
  const windowKey = useWindowKeyForSurface("stream");
  const streamInfo = useSelector(
    (state) => selectOutputSlot(state, output.id, "stream").info,
  );
  const prevStreamInfo = useSelector(
    (state) => selectOutputSlot(state, output.id, "stream").prevInfo,
  );
  const streamItemContentBlocked = useSelector(
    (state) => selectOutputSlot(state, output.id, "stream").itemContentBlocked,
  );
  const streamTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === streamInfo.timerId),
  );
  const prevStreamTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevStreamInfo.timerId),
  );

  useWakeLock();

  // Escape closes this stream's window, the same way the monitor and projector
  // windows behave. Keyed by output so one stream cannot close another.
  const closeWindow = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.closeWindow(windowKey);
    }
  }, [windowKey]);

  useCloseOnEscape(closeWindow);

  return (
    <DisplayWindow
      boxes={streamInfo.slide?.boxes || []}
      prevBoxes={prevStreamInfo.slide?.boxes || []}
      outputId={output.id}
      displayType={streamInfo.displayType}
      participantOverlayInfo={streamInfo.participantOverlayInfo}
      prevParticipantOverlayInfo={prevStreamInfo.participantOverlayInfo}
      stbOverlayInfo={streamInfo.stbOverlayInfo}
      prevStbOverlayInfo={prevStreamInfo.stbOverlayInfo}
      bibleDisplayInfo={streamInfo.bibleDisplayInfo}
      prevBibleDisplayInfo={prevStreamInfo.bibleDisplayInfo}
      qrCodeOverlayInfo={streamInfo.qrCodeOverlayInfo}
      prevQrCodeOverlayInfo={prevStreamInfo.qrCodeOverlayInfo}
      imageOverlayInfo={streamInfo.imageOverlayInfo}
      prevImageOverlayInfo={prevStreamInfo.imageOverlayInfo}
      formattedTextDisplayInfo={streamInfo.formattedTextDisplayInfo}
      prevFormattedTextDisplayInfo={prevStreamInfo.formattedTextDisplayInfo}
      boardPostStreamInfo={streamInfo.boardPostStreamInfo}
      prevBoardPostStreamInfo={prevStreamInfo.boardPostStreamInfo}
      shouldAnimate
      width={100}
      timerInfo={streamTimer}
      prevTimerInfo={prevStreamTimer}
      streamItemContentBlocked={streamItemContentBlocked}
      localVideoInput={streamInfo.localVideoInput}
      prevLocalVideoInput={prevStreamInfo.localVideoInput}
      canCaptureLocalVideo
    />
  );
};

export default Stream;
