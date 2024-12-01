import { useSelector } from "../hooks";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";

const Stream = () => {
  const { streamInfo, prevStreamInfo } = useSelector(
    (state) => state.presentation
  );

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
      shouldAnimate
      width={100}
    />
  );
};

export default Stream;
