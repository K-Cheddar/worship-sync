import { CSSProperties, useRef } from "react";
import { Box, DisplayType, OverlayInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from '@gsap/react'
import './DisplayWindow.scss';
import DisplayBox from "./DisplayBox";

type DisplayWindowProps = {
  prevBoxes?: Box[]
  boxes?: Box[]
  onChange?: ({ index, value } : { index: number, value: string}) => void
  width: number,
  showBorder?: boolean,
  displayType?: DisplayType,
  prevOverlayInfo?: OverlayInfo
  overlayInfo?: OverlayInfo,
  shouldAnimate?: boolean,
  time?: number,
  prevTime?: number
}

const DisplayWindow = ({ 
  prevBoxes = [],
  boxes = [], 
  onChange, 
  width,
  showBorder = false, 
  displayType, 
  prevOverlayInfo,
  overlayInfo = {},
  shouldAnimate = false,
  time,
  prevTime 
  } : DisplayWindowProps) => {

  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayTimeline = useRef<GSAPTimeline | null>();
  // const prevOverlayRef = useRef<HTMLDivElement | null>(null);

  const aspectRatio = 16 / 9;
  const fontAdjustment = 42 / width;

  const showBackground = displayType === 'projector' || displayType === 'slide' || displayType === 'editor';
  const isStream = displayType === 'stream';

  useGSAP(() => {
    if (!overlayRef.current || !containerRef.current || !shouldAnimate || !isStream) return;
    const width = containerRef.current.offsetWidth

    overlayTimeline.current?.clear();

    const innerElements = ['.overlay-info-name', '.overlay-info-title', '.overlay-info-event'];
    const targets = [overlayRef.current, ...innerElements];

    overlayTimeline.current = gsap
      .timeline()
      .set(targets, { x: -width*0.75 })
    
    // Only play animate if there is overlay info
    if (overlayInfo.name || overlayInfo.title || overlayInfo.event) {
      overlayTimeline.current.to(overlayRef.current, { x: width * 0.025, duration: 1, ease: 'power1.inOut' }) 
      .to(innerElements, { x: 0, duration: 1, ease: 'power1.inOut', stagger: 0.2 }, '-=0.75')
      .to(targets, { x: -width*0.75, duration: 1, ease: 'power1.inOut', delay: 7 })
    }


  }, {scope: overlayRef, dependencies: [overlayInfo] })

  // useGSAP(() => {
  //   if (!prevOverlayRef.current) return;
  //   const width = prevOverlayRef.current.offsetWidth
  //   gsap.fromTo(prevOverlayRef.current, { x: 0 }, { x: -width - 16, duration: 0.5 });
  // }, { dependencies: [prevOverlayInfo] })

  return (
    <div
      className={`display-window ${showBorder ? 'border border-gray-500' : ''} ${displayType !== 'stream' ? 'bg-black' : ''}`}
      ref={containerRef}
      style={{
      '--slide-editor-height': `${width / aspectRatio}vw`,
      '--slide-editor-width': `${width}vw`,
      } as React.CSSProperties}
      >
      <ul>
        {boxes.map((box, index) => {
          return (
            <DisplayBox
              key={box.id}
              box={box}
              width={width}
              displayType={displayType}
              showBackground={showBackground}
              isStream={isStream}
              fontAdjustment={fontAdjustment}
              onChange={onChange}
              index={index}
              shouldAnimate={shouldAnimate}
              prevBox={prevBoxes[index]}
              time={time}
            />
          )
        })}
      </ul>
      <ul>
        {prevBoxes.map((box, index) => {
          return (
            <DisplayBox
              key={box.id}
              box={box}
              width={width}
              displayType={displayType}
              showBackground={showBackground}
              isStream={isStream}
              fontAdjustment={fontAdjustment}
              onChange={onChange}
              index={index}
              shouldAnimate={shouldAnimate}
              isPrev
              time={prevTime}
            />
          )
          
        })}
      </ul>
      {/* {hasPrevOverlayData && (
        <div 
          ref={prevOverlayRef}
          className="overlay-info-container"
          style={{
            '--overlay-info-border-width' :`${width / 71.4}vw`,
            '--overlay-info-name-size': `${width / 31.3}vw`,
            '--overlay-info-title-size': `${width / 41.2}vw`,
            '--overlay-info-event-size': `${width / 50}vw`,
          } as CSSProperties}
        >
          {prevOverlayInfo.name && <p className="overlay-info-name">{prevOverlayInfo.name}</p>}
          {prevOverlayInfo.title && <p className="overlay-info-title">{prevOverlayInfo.title}</p>}
          {prevOverlayInfo.event && <p className="overlay-info-event">{prevOverlayInfo.event}</p>}         
      </div>
     )} */}

      {isStream && (
        <div 
          ref={overlayRef}
          className="overlay-info-container"
          style={{
            '--overlay-info-border-width' :`${width / 71.4}vw`,
            '--overlay-info-name-size': `${width / 31.3}vw`,
            '--overlay-info-title-size': `${width / 41.2}vw`,
            '--overlay-info-event-size': `${width / 50}vw`,
          } as CSSProperties}
        >
          {overlayInfo.name && <p className="overlay-info-name">{overlayInfo.name}</p>}
          {overlayInfo.title && <p className="overlay-info-title">{overlayInfo.title}</p>}
          {overlayInfo.event && <p className="overlay-info-event">{overlayInfo.event}</p>}         
        </div>
      )}

    </div>
  )
}

export default DisplayWindow