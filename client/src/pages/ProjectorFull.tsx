import { useSelector } from "../hooks";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";
import { useEffect } from "react";

const ProjectorFull = () => {
  const { projectorInfo, prevProjectorInfo } = useSelector(
    (state) => state.presentation
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
      boxes={projectorInfo.slide?.boxes || []}
      prevBoxes={prevProjectorInfo.slide?.boxes || []}
      displayType={projectorInfo.displayType}
      shouldAnimate
      width={100}
    />
  );
};

export default ProjectorFull;
