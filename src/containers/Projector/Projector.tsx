import { _boxes } from "../SlideEditor/dummyBoxes";
import Presentation from "../../components/Presentation/Presentation";
import { useState } from "react";
import { dummyLinks } from "./dummyLinks";


const Projector = () => {
  const [isTransmitting, setIsTransmitting] = useState(false);

  return (
    <Presentation name="Projector" boxes={_boxes} isTransmitting={isTransmitting} setIsTransmitting={setIsTransmitting} quickLinks={dummyLinks} />
  )

}

export default Projector;