import { useEffect, useState } from "react"
import Toggle from "../../components/Toggle/Toggle"
import { useDispatch, useSelector } from "../../hooks"
import { setTransmitToAll, toggleMonitorTransmitting, toggleStreamTransmitting, toggleProjectorTransmitting } from "../../store/presentationSlice"
import Presentation from "../../components/Presentation/Presentation"
import { dummyMonitorLinks, dummyOverlayLinks, dunmmyProjectorLinks } from "./dummyLinks"

const TransmitHandler = ({ className } : { className: string}) => {
  const { 
    isMonitorTransmitting, 
    isProjectorTransmitting, 
    isStreamTransmitting,
    prevProjectorInfo,
    prevMonitorInfo,
    prevStreamInfo,
    projectorInfo,
    monitorInfo,
    streamInfo
  } = useSelector((state) => state.presentation)
  const [isTransmitting, setIsTransmitting] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    setIsTransmitting(isMonitorTransmitting && isProjectorTransmitting && isStreamTransmitting)
  }, [isMonitorTransmitting, isProjectorTransmitting, isStreamTransmitting])

  const handleSetTransmitting = () => {
    setIsTransmitting(!isTransmitting)
    dispatch(setTransmitToAll(!isTransmitting))
  }

  return (
    <section className={className}>
      <div className="w-full flex justify-center">
        <Toggle label="Transmitting to all" value={isTransmitting} onChange={handleSetTransmitting}/>
      </div>
        <Presentation 
          name="Projector" 
          prevInfo={prevProjectorInfo}
          info={projectorInfo}
          isTransmitting={isProjectorTransmitting} 
          toggleIsTransmitting={() => dispatch(toggleProjectorTransmitting())} 
          quickLinks={dunmmyProjectorLinks} 
        />
        <Presentation 
          name="Monitor" 
          prevInfo={prevMonitorInfo}
          info={monitorInfo}
          isTransmitting={isMonitorTransmitting} 
          toggleIsTransmitting={() => dispatch(toggleMonitorTransmitting())} 
          quickLinks={dummyMonitorLinks} 
        />
        <Presentation 
          name="Stream" 
          prevInfo={prevStreamInfo}
          info={streamInfo}
          isTransmitting={isStreamTransmitting} 
          toggleIsTransmitting={() => dispatch(toggleStreamTransmitting())} 
          quickLinks={dummyOverlayLinks} 
        />
    </section>
  )
}

export default TransmitHandler