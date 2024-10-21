import Button from '../../components/Button/Button'
import generateRandomId from '../../utils/generateRandomId'
import { ReactComponent as LockSVG } from "../../assets/icons/lock.svg";
import { ReactComponent as UnlockSVG } from "../../assets/icons/unlock.svg";
import { ReactComponent as UnknownSVG } from "../../assets/icons/unknown-document.svg";
import './SlideEditor.scss'
import { useState } from 'react';
import { borderColorMap, iconColorMap, svgMap } from '../../utils/itemTypeMaps';
import cn from 'classnames';
import Icon from '../../components/Icon/Icon';

type Box = {
  text?: string,
  id: string,
  isLocked: boolean,
  image?: string,
  width: number,
  height: number,
  label?: string,
  fontSize?: number,
  align: 'left' | 'right' | 'center',
  marginTop: number,
  marginBottom: number
  marginLeft: number,
  marginRight: number
}

const _boxes: Box[] = [
  {
    label: 'background',
    id: generateRandomId(),
    isLocked: true,
    image: 'https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/28-08-A1_j5o3cp',
    width: 100,
    height: 100,
    align: 'center',
    marginBottom: 0,
    marginTop: 0,
    marginLeft: 0,
    marginRight: 0
  },
  {
    text: `There's a welcome here
There's a welcome here
There's an Eliathah welcome here`,
    id: generateRandomId(),
    isLocked: false,
    width: 100,
    height: 100,
    fontSize: 2.5,
    align: 'center',
    marginBottom: 3,
    marginTop: 3,
    marginLeft: 4,
    marginRight: 4
  },
  {
    text: 'Artist Name',
    id: generateRandomId(),
    isLocked: true,
    width: 100,
    height: 100,
    align: 'center',
    marginBottom: 1,
    marginTop: 1,
    marginLeft: 1,
    marginRight: 1
  }
]

const item = {
  name: "There's a welcome here",
  type: 'song',
}

const SlideEditor = () => {
  const aspectRatio = 16 / 9;
  const height = 24
  const width = height * aspectRatio;

  const [boxes, setBoxes] = useState(_boxes);

  const svg = svgMap.get(item.type);

  return (
    <div>
      <section className="w-full">
        <h3 className={`w-fit px-2 mx-auto flex-1 border-b-2 ${borderColorMap.get(item.type)} mb-1 text-2xl font-semibold`}>{item.name}</h3>
      </section>
      <div className="flex">
        <section className="w-36">
          <p className="text-center font-semibold border-b-2 border-black ">Boxes</p>
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
        <section className="slide-editor" style={{
          '--slide-editor-height': `${height}vw`,
          '--slide-editor-width': `${width}vw`,
        } as React.CSSProperties}>
          {boxes.map((box, index) => {
            return (
              <div 
                key={box.id} 
                className="absolute"
                style={{
                  width: `calc(${box.width}% - ${box.marginLeft + box.marginRight}%)`,
                  // % margin is calculated based on the width so we get the percentage of top and bottom margin, then multiply by the width of the container
                  height: `calc(${box.height}% - (${width}vw * (${box.marginTop} + ${box.marginBottom}) / 100) )`, 
                  pointerEvents: box.isLocked ? 'none' : 'all',
                  fontSize: box.fontSize ? `${box.fontSize}vw` : undefined,
                  marginTop: `${box.marginTop}%`,
                  marginBottom: `${box.marginBottom}%`,
                  marginLeft: `${box.marginLeft}%`,
                  marginRight: `${box.marginRight}%`,
                }}
              >
                {box.image && <img className="h-full w-full" src={box.image} alt={box.text || box.label}/> }
                {box.text && <textarea 
                  className="h-full w-full bg-transparent" 
                  value={box.text} 
                  style={{ textAlign: box.align }}
                  onChange={(e) => {
                    setBoxes(boxes.map((b) => {
                      if(b.id === box.id) return {...b, text: e.target.value}
                      return b
                    }))
                  }}/>}
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}

export default SlideEditor;