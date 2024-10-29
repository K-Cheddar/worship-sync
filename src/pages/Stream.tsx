import { useSelector } from "../hooks";
import DisplayWindow from "../components/DisplayWindow/DisplayWindow";

const Stream = () => {
  const { streamInfo, prevStreamInfo } = useSelector((state) => state.presentation)

  return (
    <DisplayWindow 
        boxes={streamInfo.slide?.boxes || []} 
        prevBoxes={prevStreamInfo.slide?.boxes || []}
        displayType={streamInfo.displayType}
        overlayInfo={streamInfo.overlayInfo}
        prevOverlayInfo={prevStreamInfo.overlayInfo}
        shouldAnimate
        width={100}
      />
  )
}

export default Stream;