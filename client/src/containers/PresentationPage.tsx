import { useEffect, useState } from "react";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import Button from "../components/Button/Button";
import { Presentation as PresentationType } from "../types";

type PresentationProps = {
  displayInfo: PresentationType
  prevDisplayInfo: PresentationType
}

const Presentation = ({ displayInfo, prevDisplayInfo } : PresentationProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleClick = () => {
    document.body.requestFullscreen();
  }

  useEffect(() => {
    const onFullScreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    }

    document.addEventListener('fullscreenchange', onFullScreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullScreenChange);
    }
  }, [])

  return (
    isFullscreen ? (
      <DisplayWindow 
        boxes={displayInfo.slide?.boxes || []} 
        prevBoxes={prevDisplayInfo.slide?.boxes || []}
        displayType={displayInfo.displayType}
        shouldAnimate
        width={100}
      />
    ) : (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <Button variant="cta" onClick={handleClick} className="text-7xl">
          Click to go Fullscreen
        </Button>
      </div>
    )
  )
}

export default Presentation;