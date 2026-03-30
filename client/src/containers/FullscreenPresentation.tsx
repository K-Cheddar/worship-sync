import { useEffect, useState } from "react";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import Button from "../components/Button/Button";
import { Presentation as PresentationType, TimerInfo } from "../types";

type FullscreenPresentationProps = {
  displayInfo: PresentationType;
  prevDisplayInfo: PresentationType;
  timerInfo?: TimerInfo;
  prevTimerInfo?: TimerInfo;
};

/** Fullscreen output for /projector and /monitor. For toolbar previews see PresentationPreview. */
const FullscreenPresentation = ({
  displayInfo,
  prevDisplayInfo,
  timerInfo,
  prevTimerInfo,
}: FullscreenPresentationProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isElectron, setIsElectron] = useState(false);

  const handleClick = () => {
    document.body.requestFullscreen();
  };

  useEffect(() => {
    const checkElectron = async () => {
      if (window.electronAPI) {
        const result = await window.electronAPI.isElectron();
        setIsElectron(result);
        // In Electron, windows are always fullscreen, so set it immediately
        if (result) {
          setIsFullscreen(true);
        }
      }
    };
    checkElectron();
  }, []);

  useEffect(() => {
    // Only listen for browser fullscreen changes if not in Electron
    if (isElectron) return;

    const onFullScreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };

    document.addEventListener("fullscreenchange", onFullScreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullScreenChange);
    };
  }, [isElectron]);

  const displayWindowProps = {
    boxes: displayInfo.slide?.boxes || [],
    prevBoxes: prevDisplayInfo.slide?.boxes || [],
    nextBoxes: displayInfo.nextSlide?.boxes ?? [],
    prevNextBoxes: prevDisplayInfo.nextSlide?.boxes ?? [],
    bibleInfoBox: displayInfo.bibleInfoBox,
    displayType: displayInfo.displayType,
    timerInfo,
    prevTimerInfo,
    shouldAnimate: true,
    shouldPlayVideo: true,
    width: 100,
    showMonitorClockTimer: true,
    // The standalone monitor page is the other surface that should use full monitor chrome.
    monitorLayoutMode:
      displayInfo.displayType === "monitor" ? "full-monitor" : "content-only",
    transitionDirection: displayInfo.transitionDirection,
  } as const;

  return isFullscreen ? (
    <DisplayWindow {...displayWindowProps} />
  ) : (
    <div className="h-dvh w-dvw flex flex-col items-center justify-center bg-black gap-10">
      <Button
        className="text-[min(3vw,30px)]"
        variant="secondary"
        component="link"
        to="/"
        padding="px-6 py-2"
      >
        Home
      </Button>
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

export default FullscreenPresentation;
