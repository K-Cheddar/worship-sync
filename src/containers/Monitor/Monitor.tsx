import { useState } from "react";
import Presentation from "../../components/Presentation/Presentation";
import { dummyLinks } from "./dummyLinks";


const Monitor = () => {
  const [isTransmitting, setIsTransmitting] = useState(false);
  return (
    <Presentation name="Monitor" boxes={[]} isTransmitting={isTransmitting} setIsTransmitting={setIsTransmitting} quickLinks={dummyLinks} />
  )

}

export default Monitor;