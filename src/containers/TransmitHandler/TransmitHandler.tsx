import { useState } from "react"
import Toggle from "../../components/Toggle/Toggle"
import Projector from "../Projector/Projector"
import Monitor from "../Monitor/Monitor"
import Overlay from "../Overlay/Overlay"

const TransmitHandler = ({ className } : { className: string}) => {

  const [isTransmitting, setIsTransmitting] = useState(false)

  return (
    <section className={className}>
      <div className="w-full flex justify-center">
        <Toggle label="Transmitting to all" value={isTransmitting} onChange={(val) => setIsTransmitting(val)}/>
      </div>
        <Projector/>
        <Monitor/>
        <Overlay/>
    </section>
  )
}

export default TransmitHandler