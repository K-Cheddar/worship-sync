import { useRef } from "react";
import { BibleDisplayInfo, Box, DisplayType, OverlayInfo } from "../../types";
import "./DisplayWindow.scss";
import DisplayBox from "./DisplayBox";
import DisplayStreamBible from "./DisplayStreamBible";
import DisplayFlOverlay from "./DisplayFlOverlay";
import DisplayStbOverlay from "./DisplayStbOverlay";

type DisplayWindowProps = {
  prevBoxes?: Box[];
  boxes?: Box[];
  onChange?: ({
    index,
    value,
    box,
    cursorPosition,
  }: {
    index: number;
    value: string;
    box: Box;
    cursorPosition: number;
  }) => void;
  width: number;
  showBorder?: boolean;
  displayType?: DisplayType;
  prevOverlayInfo?: OverlayInfo;
  flOverlayInfo?: OverlayInfo;
  stbOverlayInfo?: OverlayInfo;
  bibleDisplayInfo?: BibleDisplayInfo;
  prevBibleDisplayInfo?: BibleDisplayInfo;
  shouldAnimate?: boolean;
  time?: number;
  prevTime?: number;
};

const DisplayWindow = ({
  prevBoxes = [],
  boxes = [],
  onChange,
  width,
  showBorder = false,
  displayType,
  prevOverlayInfo,
  flOverlayInfo = {},
  stbOverlayInfo = {},
  shouldAnimate = false,
  time,
  prevTime,
  bibleDisplayInfo,
  prevBibleDisplayInfo,
}: DisplayWindowProps) => {
  const containerRef = useRef<HTMLUListElement | null>(null);

  const aspectRatio = 16 / 9;
  const fontAdjustment = width === 42 ? 1 : 42.35 / width; // Display editor is 42vw but sometimes the display gets clipped on other windows

  const showBackground =
    displayType === "projector" ||
    displayType === "slide" ||
    displayType === "editor";
  const isStream = displayType === "stream";

  return (
    <ul
      className={`display-window ${
        showBorder ? "border border-gray-500" : ""
      } ${displayType !== "stream" ? "bg-black" : ""}`}
      ref={containerRef}
      style={
        {
          "--slide-editor-height": `${width / aspectRatio}vw`,
          "--slide-editor-width": `${width}vw`,
        } as React.CSSProperties
      }
    >
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
        );
      })}
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
        );
      })}

      <DisplayStreamBible
        width={width}
        shouldAnimate={shouldAnimate}
        bibleDisplayInfo={bibleDisplayInfo}
        prevBibleDisplayInfo={prevBibleDisplayInfo}
        isStream={isStream}
        ref={containerRef}
      />

      <DisplayStbOverlay
        width={width}
        shouldAnimate={shouldAnimate}
        stbOverlayInfo={stbOverlayInfo}
        isStream={isStream}
        ref={containerRef}
      />

      <DisplayFlOverlay
        width={width}
        shouldAnimate={shouldAnimate}
        flOverlayInfo={flOverlayInfo}
        isStream={isStream}
        ref={containerRef}
      />
    </ul>
  );
};

export default DisplayWindow;
