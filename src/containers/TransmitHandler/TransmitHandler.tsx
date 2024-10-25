import { useEffect, useState } from "react"
import Toggle from "../../components/Toggle/Toggle"
import { useDispatch, useSelector } from "../../hooks"
import { setTransmitToAll, toggleMonitorTransmitting, toggleOverlayTransmitting, toggleProjectorTransmitting } from "../../store/presentationSlice"
import Presentation from "../../components/Presentation/Presentation"
import { dummyMonitorLinks, dummyOverlayLinks, dunmmyProjectorLinks } from "./dummyLinks"

const TransmitHandler = ({ className } : { className: string}) => {
  const { 
    isMonitorTransmitting, 
    isProjectorTransmitting, 
    isOverlayTransmitting,
    projectorInfo,
    monitorInfo,
    overlayInfo
  } = useSelector((state) => state.presentation)
  const [isTransmitting, setIsTransmitting] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    setIsTransmitting(isMonitorTransmitting && isProjectorTransmitting && isOverlayTransmitting)
  }, [isMonitorTransmitting, isProjectorTransmitting, isOverlayTransmitting])

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
          info={projectorInfo}
          isTransmitting={isProjectorTransmitting} 
          toggleIsTransmitting={() => dispatch(toggleProjectorTransmitting())} 
          quickLinks={dunmmyProjectorLinks} 
        />
        <Presentation 
          name="Monitor" 
          info={monitorInfo}
          isTransmitting={isMonitorTransmitting} 
          toggleIsTransmitting={() => dispatch(toggleMonitorTransmitting())} 
          quickLinks={dummyMonitorLinks} 
        />
        <Presentation 
          name="Overlay" 
          info={overlayInfo}
          isTransmitting={isOverlayTransmitting} 
          toggleIsTransmitting={() => dispatch(toggleOverlayTransmitting())} 
          quickLinks={dummyOverlayLinks} 
        />
    </section>
  )
}

export default TransmitHandler