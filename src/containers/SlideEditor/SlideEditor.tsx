import Button from '../../components/Button/Button'
import { ReactComponent as LockSVG } from "../../assets/icons/lock.svg";
import { ReactComponent as UnlockSVG } from "../../assets/icons/unlock.svg";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import { ReactComponent as ExpandSVG } from '../../assets/icons/expand.svg';
import { ReactComponent as CollapseSVG } from '../../assets/icons/collapse.svg';
import './SlideEditor.scss'
import { useState } from 'react';
import { borderColorMap, iconColorMap, svgMap } from '../../utils/itemTypeMaps';
import Icon from '../../components/Icon/Icon';
import { _boxes } from './dummyBoxes';
import DisplayWindow from '../../components/DisplayWindow/DisplayWindow';

const item = {
  name: "There's a welcome here",
  type: 'song',
}

const SlideEditor = () => {
  const [boxes, setBoxes] = useState(_boxes);
  const [showEditor, setShowEditor] = useState(true);

  const svg = svgMap.get(item.type);

  return (
    <div>
      <section className="flex slide-editor-container">
        <section className={`flex mx-auto mb-1 px-2 items-center gap-2 border-b-2 w-fit ${borderColorMap.get(item.type)}`}>
          <Icon svg={svg || UnknownSVG} color={iconColorMap.get(item.type)} />
          <h3 className={`font-semibold`}>{item.name}</h3>
        </section>
        <Button 
          variant='tertiary'
          padding="p-0"
          svg={showEditor ? CollapseSVG : ExpandSVG} 
          onClick={() => setShowEditor(!showEditor)}
          className="text-xs mb-1"
        >
        </Button>
      </section>
      {showEditor && (
        <div className="flex">
          <section className="w-36">
            <p className="text-center font-semibold border-b-2 border-black ">Slide Content</p>
            {boxes.map((box, index) => {
              return (
                <span key={box.id} className={`flex gap-1 bg-slate-600 border-slate-300 ${index !== boxes.length - 1 && 'border-b'}`}>
                  <Button truncate className="flex-1 text-xs hover:bg-slate-500" variant="none">
                    <p>{box.label ||box.text}</p>
                  </Button>
                  <Button 
                    svg={box.isLocked ? LockSVG : UnlockSVG} 
                    color={box.isLocked ? 'gray' : 'green'} 
                    variant="tertiary"
                    onClick={() => setBoxes(boxes.map((b) => b.id === box.id ? {...b, isLocked: !b.isLocked} : b))}
                  />
                </span>
              )
            })}
          </section>
          <DisplayWindow 
            boxes={boxes}
            onChange={({ currentBox, value }) => setBoxes(boxes.map((b) => b.id === currentBox.id ? {...b, text: value} : b))} 
            width={42} />
       </div> 
      )}
    </div>
  )
}

export default SlideEditor;