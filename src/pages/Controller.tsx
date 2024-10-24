import { Resizable } from "re-resizable";
import EditorButtons from "../containers/EditorPanel/EditorButtons";
import ItemSlides from "../containers/ItemSlides/ItemSlides";
import Media from "../containers/Media/Media";
import Monitor from "../containers/Monitor/Monitor";
import Overlay from "../containers/Overlay/Overlay";
import Projector from "../containers/Projector/Projector";
import ServiceItems from "../containers/ServiceItems/ServiceItems";
import SlideEditor from "../containers/SlideEditor/SlideEditor";
import Toolbar from "../containers/Toolbar/Toolbar";
import TransmitHandler from "../containers/TransmitHandler/TransmitHandler";

import './pages.scss'

const resizableDirections = { top:false, right:true, bottom:false, left:false, topRight:false, bottomRight:false, bottomLeft:false, topLeft:false }

const Controller = () => {
  return (
    <div className="bg-slate-700 h-screen flex flex-col text-white overflow-hidden list-none">
      <Toolbar className="flex border-b-2 border-slate-500 h-10 text-sm" />
      <div className="flex flex-1 controller-main gap-2">
        <Resizable defaultSize={{ width: "15%" }} className="flex flex-col border-r-2 border-slate-500" enable={resizableDirections}>
          <EditorButtons/>
          <ServiceItems/>
        </Resizable>
        <Resizable className="flex flex-col" enable={resizableDirections}>
          <SlideEditor/>
          <ItemSlides/>
        </Resizable>
        <section className="flex flex-col gap-4 w-fit items-center h-fit bg-slate-800 p-4 rounded-lg mx-auto">
          <TransmitHandler/>
          <Projector/>
          <Monitor/>
          <Overlay/>
          {/* <Media/> */}
        </section>
      </div>
    </div>
  )
}

export default Controller;