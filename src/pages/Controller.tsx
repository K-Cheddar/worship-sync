import { Resizable } from "re-resizable";
import EditorButtons from "../containers/EditorPanel/EditorButtons";
import ItemSlides from "../containers/ItemSlides/ItemSlides";
import Media from "../containers/Media/Media";
import ServiceItems from "../containers/ServiceItems/ServiceItems";
import SlideEditor from "../containers/ItemEditor/SlideEditor";
import Toolbar from "../containers/Toolbar/Toolbar";
import TransmitHandler from "../containers/TransmitHandler/TransmitHandler";

import './pages.scss'
import LyricsEditor from "../containers/ItemEditor/LyricsEditor";
import { useState } from "react";
import { MiddleSection } from "../types";
import Participants from "../containers/Participants/Participants";

const resizableDirections = { top:false, right:false, bottom:false, left:false, topRight:false, bottomRight:false, bottomLeft:false, topLeft:false }

const Controller = () => {
  const [middleSection, setMiddleSection] = useState<MiddleSection>('service-item')
  return (
    <div className="bg-slate-700 w-screen h-screen flex flex-col text-white overflow-hidden list-none">
      <Toolbar className="flex border-b-2 border-slate-500 h-10 text-sm" />
      <div className="controller-main ">
        <LyricsEditor />
        <Resizable defaultSize={{ width: "15%" }} className="flex flex-col border-r-2 border-slate-500" enable={resizableDirections}>
          <EditorButtons middleSection={middleSection} setMiddleSection={setMiddleSection}/>
          <ServiceItems setMiddleSection={setMiddleSection}/>
        </Resizable>
        <Resizable defaultSize={{ width: "55%" }} className="flex flex-col flex-1 border-r-2 border-slate-500 relative" enable={resizableDirections}>
          {middleSection === 'service-item' && (
            <>
              <SlideEditor/>
              <ItemSlides/>
            </>
          )}
          {middleSection === 'participants-panel' && <Participants/>}
        </Resizable>
        <Resizable defaultSize={{ width: "30%" }} className="flex flex-col" enable={{...resizableDirections}}>
          <TransmitHandler className="flex flex-col mt-2 gap-4 w-fit items-center h-fit bg-slate-800 p-4 rounded-lg mx-auto"/>
          <Media/>
        </Resizable>
      </div>
    </div>
  )
}

export default Controller;