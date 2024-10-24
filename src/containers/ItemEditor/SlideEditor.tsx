import Button from '../../components/Button/Button'
import { ReactComponent as LockSVG } from "../../assets/icons/lock.svg";
import { ReactComponent as UnlockSVG } from "../../assets/icons/unlock.svg";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import { ReactComponent as ExpandSVG } from '../../assets/icons/expand.svg';
import { ReactComponent as CollapseSVG } from '../../assets/icons/collapse.svg';
import { ReactComponent as EditSVG } from "../../assets/icons/edit.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import Input from "../../components/Input/Input";
import './ItemEditor.scss'
import { useState } from 'react';
import { borderColorMap, iconColorMap, svgMap } from '../../utils/itemTypeMaps';
import Icon from '../../components/Icon/Icon';
import DisplayWindow from '../../components/DisplayWindow/DisplayWindow';
import { useDispatch, useSelector } from '../../hooks';
import { toggleEditMode } from '../../store/itemSlice';
import { setName, updateBoxes } from "../../store/itemSlice";


const item = {
  name: "There's a welcome here",
  type: 'song',
}

const SlideEditor = () => {
  const { name, type, arrangements, selectedArrangement, selectedSlide } = useSelector(state => state.item);
  const [showEditor, setShowEditor] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false)
  const [localName, setLocalName] = useState(name)

  const dispatch = useDispatch();


  const saveName = () => {
    setIsEditingName(false)
    dispatch(setName(localName))
  }

  const boxes = arrangements[selectedArrangement].slides[selectedSlide].boxes;

  // console.log({boxes})

  const nameClasses = "text-base font-semibold w-fit max-w-15 truncate"

  return (
    <div>
      <section className="flex justify-end w-full pr-2 bg-slate-900 h-8 mb-1 gap-1">
        <span className={`flex mr-auto px-2 items-center gap-2 border-l-4 w-fit ${borderColorMap.get(item.type)}`}>
          <Button
            variant="tertiary" 
            className="mr-2" 
            svg={isEditingName ? CheckSVG : EditSVG} 
            onClick={
              isEditingName ? () => saveName() : () => setIsEditingName(true)
            }
          />
          {!isEditingName && <h2 className={nameClasses}>{name}</h2>}
          {isEditingName && <Input hideLabel className={nameClasses} value={localName} onChange={(val) => setLocalName(val as string)}/>}
        </span>
        {type === 'song' && <Button className="text-sm" onClick={() => dispatch(toggleEditMode())}>Edit Lyrics</Button>}
        <Button 
          variant='tertiary'
          padding="p-0"
          svg={showEditor ? CollapseSVG : ExpandSVG} 
          onClick={() => setShowEditor(!showEditor)}
          className="text-xs"
        >
        </Button>
      </section>
      {showEditor && (
        <div className="flex">
          <section className="w-[10vw]">
            <p className="text-center font-semibold border-b-2 border-black text-lg">Slide Content</p>
            {boxes.map((box, index) => {
              return (
                <span key={box.id} className={`flex gap-1 bg-slate-600 border-slate-300 ${index !== boxes.length - 1 && 'border-b'}`}>
                  <Button truncate className="flex-1 text-xs hover:bg-slate-500" variant="none">
                    <p>{box.label || box.words?.trim() || box.background}</p>
                  </Button>
                  <Button 
                    svg={box.isLocked ? LockSVG : UnlockSVG} 
                    color={box.isLocked ? 'gray' : 'green'} 
                    variant="tertiary"
                    onClick={() => dispatch(updateBoxes(boxes.map((b, i) => i === index ? {...b, isLocked: !b.isLocked} : b)))}
                  />
                </span>
              )
            })}
          </section>
          <DisplayWindow 
            boxes={boxes}
            onChange={({ index, value }) => dispatch(updateBoxes(boxes.map((b, i) => i === index ? {...b, words: value} : b)))} 
            width={42} />
       </div> 
      )}
    </div>
  )
}

export default SlideEditor;