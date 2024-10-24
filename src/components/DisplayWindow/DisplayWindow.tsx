import { useRef } from "react";
import { Box } from "../../types";
import './DisplayWindow.scss';

type DisplayWindowProps = {
  boxes: Box[]
  onChange?: ({ index, value } : { index: number, value: string}) => void
  width: number
}

const DisplayWindow = ({ boxes, onChange, width } : DisplayWindowProps) => {

  const containerRef = useRef<HTMLUListElement | null>(null);

  const aspectRatio = 16 / 9;
  const fontAdjustment = 42 / width;

  console.log({boxes})

  return (
    <ul 
      className="display-window" 
      ref={containerRef}
      style={{
      '--slide-editor-height': `${width / aspectRatio}vw`,
      '--slide-editor-width': `${width}vw`,
      } as React.CSSProperties}
    >
    {boxes.map((box, index) => {
      const fontSizeValue = box.fontSize ? box.fontSize / fontAdjustment : 1;
      const tSS = fontSizeValue / (width > 20 ? 32 : 10) ; // text shadow size
      const fOS = fontSizeValue / (width > 20 ? 32 : 114); // font outline size
      const textStyles = {
        textShadow: `${tSS}vw ${tSS}vw ${tSS}vw #000, ${tSS}vw ${tSS}vw ${tSS}vw #000`,
        WebkitTextStroke: `${fOS}vw #000`,
        textAlign: box.align || 'center'
      }
      return (
        <li 
          key={box.id} 
          className="absolute leading-tight"
          style={{
            width: `calc(${box.width}% - ${box.sideMargin ? box.sideMargin * 2 : 0}%)`,
            // % margin is calculated based on the width so we get the percentage of top and bottom margin, then multiply by the width of the container
            height: `calc(${box.height}% - (${width}vw * (${box.topMargin || 0} + ${box.topMargin || 0}) / 100) )`, 
            pointerEvents: box.isLocked ? 'none' : 'all',
            fontSize: `${fontSizeValue}vw`,
            marginTop: `${box.topMargin}%`,
            marginBottom: `${box.topMargin}%`,
            marginLeft: `${box.sideMargin}%`,
            marginRight: `${box.sideMargin}%`
          }}
        >
          {box.background && <img className="h-full w-full absolute" src={box.background} alt={box.words || box.label}/> }
          {typeof onChange !== 'function' && (
            <p className="h-full w-full bg-transparent whitespace-pre-line absolute" style={textStyles}>{box.words}</p>
          )}
          {typeof onChange === 'function' && (
            <textarea 
              className="h-full w-full bg-transparent absolute resize-none" 
              value={box.words} 
              style={textStyles}
              onChange={(e) => onChange({index, value: e.target.value})}
              
            />)}
        </li>
      )
    })}
  </ul>
  )
}

export default DisplayWindow