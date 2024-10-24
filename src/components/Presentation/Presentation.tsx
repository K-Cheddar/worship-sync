import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Toggle from "../../components/Toggle/Toggle";
import QuickLink from "../../components/QuickLink/QuickLink";
import { Box, QuickLinkType } from "../../types";

type PresentationProps = {
  name: string
  boxes: Box[]
  isTransmitting: boolean
  setIsTransmitting: (val: boolean) => void
  quickLinks: QuickLinkType[],
}

const Presentation = ({ name, boxes, isTransmitting, setIsTransmitting, quickLinks} : PresentationProps) => {
  return (
    <div className="flex gap-2">
      <section className="w-fit">
        <h2 className="bg-slate-900 text-center font-semibold text-base">{name}</h2>
        <DisplayWindow boxes={boxes} width={14} /> 
      </section>
      <section className="gap-2 flex flex-col pt-2">
        <Toggle label="Transmitting" value={isTransmitting} onChange={(val) => setIsTransmitting(val)}/>
        <section className="grid grid-cols-2">
          {quickLinks.map((link) => <QuickLink {...link} key={link.id}/>)}
        </section>
      </section>
    </div>
  )

}

export default Presentation;