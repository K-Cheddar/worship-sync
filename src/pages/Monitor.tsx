import { useSelector } from "../hooks";
import Presentation from "../containers/PresentationPage";

const Monitor = () => {
  const { monitorInfo, prevMonitorInfo } = useSelector((state) => state.presentation)
 
  return (
    <Presentation displayInfo={monitorInfo} prevDisplayInfo={prevMonitorInfo}/>
  )
}

export default Monitor;