import { Box, DisplayType } from "../../types";

type DisplayBoxProps = {
  box: Box,
  width: number,
  displayType?: DisplayType,
  showBackground: boolean,
  isStream: boolean,
  fontAdjustment: number,
  onChange?: Function,
  index: number
}

const DisplayBox = ({ box, width, displayType, showBackground, isStream, fontAdjustment, onChange, index } : DisplayBoxProps ) => {
  const bFontSize = isStream ? 1 : box.fontSize;
  const bWords = box.words || '';
  const words = isStream ? bWords.trim() : bWords;
  const fontSizeValue = bFontSize ? bFontSize / fontAdjustment : 1;
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
      {displayType === 'monitor' && box.background && <div className="h-full w-full absolute bg-black"/>}
      {showBackground && box.background && <img className="h-full w-full absolute" src={box.background} alt={box.label}/> }
      {isStream && box.background && <div className="h-full w-full absolute bg-transparent"/>}
      {typeof onChange !== 'function' && (
        <p 
          className={`w-full bg-transparent whitespace-pre-line absolute ${isStream ? 'h-fit bottom-0 text-center' : 'h-full'}`}
          style={textStyles}
        >
          {words}
        </p>
      )}
      {typeof onChange === 'function' && (
        <textarea 
          className="h-full w-full bg-transparent absolute resize-none overflow-hidden" 
          value={words} 
          style={textStyles}
          onChange={(e) => onChange({index, value: e.target.value})}
          
        />)}
    </li>
  )
}

export default DisplayBox;