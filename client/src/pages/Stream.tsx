import { useSelector } from "../hooks";
import { selectOutputSlot } from "../store/presentationSlice";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import { useWakeLock } from "../hooks/useWakeLock";

const Stream = () => {
  const streamInfo = useSelector(
    (state) => selectOutputSlot(state, "stream", "stream").info,
  );
  const prevStreamInfo = useSelector(
    (state) => selectOutputSlot(state, "stream", "stream").prevInfo,
  );
  const streamItemContentBlocked = useSelector(
    (state) => selectOutputSlot(state, "stream", "stream").itemContentBlocked,
  );
  const streamTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === streamInfo.timerId),
  );
  const prevStreamTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevStreamInfo.timerId),
  );

  useWakeLock();

  return (
    <DisplayWindow
      boxes={streamInfo.slide?.boxes || []}
      prevBoxes={prevStreamInfo.slide?.boxes || []}
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
    />
  );
};

export default Stream;
