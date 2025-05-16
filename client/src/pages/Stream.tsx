import { useSelector } from "../hooks";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import { useEffect } from "react";

const Stream = () => {
  const { streamInfo, prevStreamInfo } = useSelector(
    (state) => state.presentation
  );

  const timers = useSelector((state) => state.timers.timers);
  const streamTimer = timers.find((timer) => timer.id === streamInfo.timerId);

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
      prevOverlayInfo={prevStreamInfo.participantOverlayInfo}
      stbOverlayInfo={streamInfo.stbOverlayInfo}
      prevBibleDisplayInfo={prevStreamInfo.bibleDisplayInfo}
      bibleDisplayInfo={streamInfo.bibleDisplayInfo}
      qrCodeOverlayInfo={streamInfo.qrCodeOverlayInfo}
      imageOverlayInfo={streamInfo.imageOverlayInfo}
      shouldAnimate
      width={100}
      timerInfo={streamTimer}
    />
  );
};

export default Stream;
