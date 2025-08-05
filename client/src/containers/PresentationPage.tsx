import { useEffect, useState } from "react";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import Button from "../components/Button/Button";
import { Presentation as PresentationType, TimerInfo } from "../types";

type PresentationProps = {
  displayInfo: PresentationType;
  prevDisplayInfo: PresentationType;
  timerInfo?: TimerInfo;
  prevTimerInfo?: TimerInfo;
};

const Presentation = ({
  displayInfo,
  prevDisplayInfo,
  timerInfo,
  prevTimerInfo,
}: PresentationProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleClick = () => {
    document.body.requestFullscreen();
  };

  useEffect(() => {
    const onFullScreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };

    document.addEventListener("fullscreenchange", onFullScreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullScreenChange);
    };
  }, []);

  return isFullscreen ? (
    <DisplayWindow
      boxes={displayInfo.slide?.boxes || []}
      prevBoxes={prevDisplayInfo.slide?.boxes || []}
      displayType={displayInfo.displayType}
      timerInfo={timerInfo}
      prevTimerInfo={prevTimerInfo}
      shouldAnimate
      width={100}
    />
  ) : (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-black gap-10">
      <p className="text-[min(5vw,50px)] p-6 bg-gray-700 text-yellow-300 text-center">
        Drag this window to the intended display
      </p>
      <Button
        variant="cta"
        onClick={handleClick}
        className="text-[min(7vw,70px)]"
        padding="px-6 py-2"
      >
        Click to go Fullscreen
      </Button>
    </div>
  );
};

export default Presentation;
