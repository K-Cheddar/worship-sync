import { useState } from "react"
import Toggle from "../../components/Toggle/Toggle"

const TransmitHandler = () => {

  const [isTransmitting, setIsTransmitting] = useState(false)

  return (
    <div className="w-full flex justify-center">
      <Toggle label="Transmitting to all" value={isTransmitting} onChange={(val) => setIsTransmitting(val)}/>
    </div>
  )
}

export default TransmitHandler