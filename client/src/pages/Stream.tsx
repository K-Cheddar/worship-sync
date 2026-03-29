import { useSelector } from "../hooks";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import { useEffect } from "react";

const Stream = () => {
  const streamInfo = useSelector((state) => state.presentation.streamInfo);
  const prevStreamInfo = useSelector((state) => state.presentation.prevStreamInfo);
  const streamItemContentBlocked = useSelector(
    (state) => state.presentation.streamItemContentBlocked
  );
  const streamTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === streamInfo.timerId)
  );
  const prevStreamTimer = useSelector((state) =>
    state.timers.timers.find((timer) => timer.id === prevStreamInfo.timerId)
  );

  useEffect(() => {
    const keepScreenOn = async () => {
      try {
        await navigator.wakeLock.request("screen");
      } catch (err) {
        console.error("Error acquiring wake lock:", err);
      }
    };

    keepScreenOn();
  }, []);

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
      shouldAnimate
      width={100}
      timerInfo={streamTimer}
      prevTimerInfo={prevStreamTimer}
      streamItemContentBlocked={streamItemContentBlocked}
    />
  );
};

export default Stream;
