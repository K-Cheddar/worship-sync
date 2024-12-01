import { useSelector } from "../hooks";
import Presentation from "../containers/PresentationPage";
import { useEffect } from "react";

const Projector = () => {
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
    <Presentation
      displayInfo={projectorInfo}
      prevDisplayInfo={prevProjectorInfo}
    />
  );
};

export default Projector;
