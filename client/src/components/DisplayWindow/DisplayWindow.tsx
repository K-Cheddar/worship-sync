import { forwardRef, MutableRefObject, useRef } from "react";
import { BibleDisplayInfo, Box, DisplayType, OverlayInfo } from "../../types";
import "./DisplayWindow.scss";
import DisplayBox from "./DisplayBox";
import DisplayStreamBible from "./DisplayStreamBible";
import DisplayParticipantOverlay from "./DisplayParticipantOverlay";
import DisplayStbOverlay from "./DisplayStbOverlay";
import DisplayQrCodeOverlay from "./DisplayQrCodeOverlay";
import DisplayEditor from "./DisplayEditor";
import DisplayStreamText from "./DisplayStreamText";
import DisplayImageOverlay from "./DisplayImageOverlay";

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
  participantOverlayInfo?: OverlayInfo;
  stbOverlayInfo?: OverlayInfo;
  qrCodeOverlayInfo?: OverlayInfo;
  imageOverlayInfo?: OverlayInfo;
  bibleDisplayInfo?: BibleDisplayInfo;
  prevBibleDisplayInfo?: BibleDisplayInfo;
  shouldAnimate?: boolean;
  shouldPlayVideo?: boolean;
  time?: number;
  prevTime?: number;
  selectBox?: (index: number) => void;
};

const DisplayWindow = forwardRef<HTMLDivElement, DisplayWindowProps>(
  (
    {
      prevBoxes = [],
      boxes = [],
      onChange,
      width,
      showBorder = false,
      displayType,
      prevOverlayInfo,
      participantOverlayInfo,
      stbOverlayInfo,
      shouldAnimate = false,
      shouldPlayVideo = false,
      time,
      prevTime,
      bibleDisplayInfo,
      prevBibleDisplayInfo,
      qrCodeOverlayInfo,
      imageOverlayInfo,
      selectBox,
    }: DisplayWindowProps,
    ref
  ) => {
    const fallbackRef = useRef<HTMLDivElement | null>(null);
    const containerRef = ref || fallbackRef;

    const aspectRatio = 16 / 9;
    const fontAdjustment = width === 42 ? 1 : 42.35 / width; // Display editor is 42vw but sometimes the display gets clipped on other windows

    const showBackground =
      displayType === "projector" ||
      displayType === "slide" ||
      displayType === "editor";
    const isStream = displayType === "stream";
    const isEditor = displayType === "editor";
    const isDisplay = !isStream && !isEditor;

    return (
      <div
        className={`display-window ${
          showBorder ? "border border-gray-500" : ""
        } ${displayType !== "stream" ? "bg-black" : ""}`}
        ref={containerRef}
        id={isEditor ? "display-editor" : undefined}
        style={
          {
            "--slide-editor-height": `${width / aspectRatio}vw`,
            "--slide-editor-width": `${width}vw`,
          } as React.CSSProperties
        }
      >
        {boxes.map((box, index) => {
          if (isEditor)
            return (
              <DisplayEditor
                key={box.id}
                box={box}
                width={width}
                fontAdjustment={fontAdjustment}
                onChange={onChange}
                index={index}
                selectBox={selectBox}
              />
            );
          if (isStream)
            return (
              <DisplayStreamText
                key={box.id}
                box={box}
                fontAdjustment={fontAdjustment}
                width={width}
                time={time}
              />
            );

          if (isDisplay)
            return (
              <DisplayBox
                key={box.id}
                box={box}
                width={width}
                displayType={displayType}
                showBackground={showBackground}
                fontAdjustment={fontAdjustment}
                index={index}
                shouldAnimate={shouldAnimate}
                shouldPlayVideo={shouldPlayVideo}
                prevBox={prevBoxes[index]}
                time={time}
              />
            );
          return null;
        })}
        {prevBoxes.map((box, index) => {
          if (isDisplay)
            return (
              <DisplayBox
                key={box.id}
                box={box}
                width={width}
                displayType={displayType}
                showBackground={showBackground}
                fontAdjustment={fontAdjustment}
                index={index}
                shouldAnimate={shouldAnimate}
                shouldPlayVideo={shouldPlayVideo}
                prevBox={prevBoxes[index]}
                time={time}
                isPrev
              />
            );
          if (isStream)
            return (
              <DisplayStreamText
                key={box.id}
                fontAdjustment={fontAdjustment}
                box={box}
                width={width}
                time={time}
                isPrev
              />
            );
          return null;
        })}

        {isStream && (
          <>
            <DisplayStreamBible
              width={width}
              shouldAnimate={shouldAnimate}
              bibleDisplayInfo={bibleDisplayInfo}
              prevBibleDisplayInfo={prevBibleDisplayInfo}
              ref={containerRef}
            />

            <DisplayStbOverlay
              width={width}
              shouldAnimate={shouldAnimate}
              stbOverlayInfo={stbOverlayInfo}
              ref={containerRef}
            />

            <DisplayParticipantOverlay
              width={width}
              shouldAnimate={shouldAnimate}
              participantOverlayInfo={participantOverlayInfo}
              ref={containerRef}
            />

            <DisplayQrCodeOverlay
              width={width}
              shouldAnimate={shouldAnimate}
              qrCodeOverlayInfo={qrCodeOverlayInfo}
              ref={containerRef}
            />

            <DisplayImageOverlay
              width={width}
              shouldAnimate={shouldAnimate}
              imageOverlayInfo={imageOverlayInfo}
              ref={containerRef}
            />
          </>
        )}
      </div>
    );
  }
);

export default DisplayWindow;
