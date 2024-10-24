import { Box } from "../../types";
import './DisplayWindow.scss';

type DisplayWindowProps = {
  boxes: Box[]
  onChange?: ({ currentBox, value } : { currentBox: Box, value: string}) => void
  width: number
}

const DisplayWindow = ({ boxes, onChange, width } : DisplayWindowProps) => {

  const aspectRatio = 16 / 9;
  const height = width / aspectRatio;
  const fontAdjustment = 42 / width;

  return (
    <ul 
      className="display-window" 
      style={{
      '--slide-editor-height': `${height}vw`,
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
        textAlign: box.align
      }
      return (
        <li 
          key={box.id} 
          className="absolute leading-tight"
          style={{
            width: `calc(${box.width}% - ${box.marginLeft + box.marginRight}%)`,
            // % margin is calculated based on the width so we get the percentage of top and bottom margin, then multiply by the width of the container
            height: `calc(${box.height}% - (${width}vw * (${box.marginTop} + ${box.marginBottom}) / 100) )`, 
            pointerEvents: box.isLocked ? 'none' : 'all',
            fontSize: `${fontSizeValue}vw`,
            marginTop: `${box.marginTop}%`,
            marginBottom: `${box.marginBottom}%`,
            marginLeft: `${box.marginLeft}%`,
            marginRight: `${box.marginRight}%`
          }}
        >
          {box.image && <img className="h-full w-full" src={box.image} alt={box.text || box.label}/> }
          {typeof onChange !== 'function' && (
            <p className="h-full w-full bg-transparent whitespace-pre-line" style={textStyles}>{box.text}</p>
          )}
          {typeof onChange === 'function' && (
            <textarea 
              className="h-full w-full bg-transparent" 
              value={box.text} 
              style={textStyles}
              onChange={(e) => onChange({currentBox: box, value: e.target.value})}
            />)}
        </li>
      )
    })}
  </ul>
  )
}

export default DisplayWindow