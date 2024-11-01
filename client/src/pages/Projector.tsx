import { useSelector } from "../hooks";
import Presentation from "../containers/PresentationPage";

const Projector = () => {
  const { projectorInfo, prevProjectorInfo } = useSelector((state) => state.presentation)

  return (
    <Presentation displayInfo={projectorInfo} prevDisplayInfo={prevProjectorInfo}/>
  )
}

export default Projector;