import { Resizable } from "re-resizable";
import EditorButtons from "../containers/EditorPanel/EditorButtons";
import ItemSlides from "../containers/ItemSlides/ItemSlides";
import Media from "../containers/Media/Media";
import Monitor from "../containers/Monitor/Monitor";
import Overlay from "../containers/Overlay/Overlay";
import Presentation from "../containers/Presentation/Presentation";
import ServiceItems from "../containers/ServiceItems/ServiceItems";
import SlideEditor from "../containers/SlideEditor/SlideEditor";
import Toolbar from "../containers/Toolbar/Toolbar";

import './pages.scss'

const resizableDirections = { top:false, right:true, bottom:false, left:false, topRight:false, bottomRight:false, bottomLeft:false, topLeft:false }

const Controller = () => {
  return (
    <div className="bg-slate-700 h-screen flex flex-col text-white">
      <Toolbar />
      <div className="flex flex-1 controller-main gap-2">
        <Resizable className="flex flex-col border-r-2 border-slate-500" enable={resizableDirections}>
          <EditorButtons/>
          <ServiceItems/>
        </Resizable>
        <Resizable className="flex flex-col pt-2" enable={resizableDirections}>
          <SlideEditor/>
          <ItemSlides/>
        </Resizable>
        <section>
          <Presentation/>
          <Monitor/>
          <Overlay/>
          <Media/>
        </section>
      </div>
    </div>
  )
}

export default Controller;