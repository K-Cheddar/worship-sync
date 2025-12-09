import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  BibleDisplayInfo,
  Box,
  DisplayType,
  FormattedTextDisplayInfo,
  OverlayInfo,
  TimerInfo,
} from "../../types";
import "./DisplayWindow.scss";
import DisplayBox from "./DisplayBox";
import DisplayStreamBible from "./DisplayStreamBible";
import DisplayParticipantOverlay from "./DisplayParticipantOverlay";
import DisplayStbOverlay from "./DisplayStbOverlay";
import DisplayQrCodeOverlay from "./DisplayQrCodeOverlay";
import DisplayEditor from "./DisplayEditor";
import DisplayStreamText from "./DisplayStreamText";
import DisplayImageOverlay from "./DisplayImageOverlay";
import DisplayStreamFormattedText from "./DisplayStreamFormattedText";
import HLSPlayer from "./HLSVideoPlayer";
import DisplayClock from "./DisplayClock";
import DisplayTimer from "./DisplayTimer";
import { useSelector } from "../../hooks";

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
  participantOverlayInfo?: OverlayInfo;
  prevParticipantOverlayInfo?: OverlayInfo;
  stbOverlayInfo?: OverlayInfo;
  prevStbOverlayInfo?: OverlayInfo;
  qrCodeOverlayInfo?: OverlayInfo;
  prevQrCodeOverlayInfo?: OverlayInfo;
  imageOverlayInfo?: OverlayInfo;
  prevImageOverlayInfo?: OverlayInfo;
  bibleDisplayInfo?: BibleDisplayInfo;
  prevBibleDisplayInfo?: BibleDisplayInfo;
  formattedTextDisplayInfo?: FormattedTextDisplayInfo;
  prevFormattedTextDisplayInfo?: FormattedTextDisplayInfo;
  timerInfo?: TimerInfo;
  prevTimerInfo?: TimerInfo;
  shouldAnimate?: boolean;
  shouldPlayVideo?: boolean;
  time?: number;
  prevTime?: number;
  selectBox?: (index: number) => void;
  selectedBox?: number;
  isBoxLocked?: boolean[];
  disabled?: boolean;
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
      participantOverlayInfo,
      prevParticipantOverlayInfo,
      stbOverlayInfo,
      prevStbOverlayInfo,
      shouldAnimate = false,
      shouldPlayVideo = false,
      time,
      prevTime,
      bibleDisplayInfo,
      prevBibleDisplayInfo,
      qrCodeOverlayInfo,
      prevQrCodeOverlayInfo,
      imageOverlayInfo,
      prevImageOverlayInfo,
      timerInfo,
      prevTimerInfo,
      selectBox,
      selectedBox,
      formattedTextDisplayInfo,
      prevFormattedTextDisplayInfo,
      isBoxLocked,
      disabled = false,
    }: DisplayWindowProps,
    ref
  ) => {
    const fallbackRef = useRef<HTMLDivElement | null>(null);
    const containerRef = ref || fallbackRef;

    const aspectRatio = 16 / 9;
    const fontAdjustment = 43 / width; // Display editor is 42vw but sometimes the display gets clipped on other windows

    const showBackground =
      displayType === "projector" ||
      displayType === "slide" ||
      displayType === "editor";
    const isStream = displayType === "stream";
    const isEditor = displayType === "editor";
    const isDisplay = !isStream && !isEditor;

    // Determine the active background video (if any) from boxes
    const { videoBox, desiredVideoUrl } = useMemo(() => {
      if (!shouldPlayVideo || !isDisplay || !showBackground)
        return { videoBox: undefined, desiredVideoUrl: undefined };
      const videoBox = boxes.find(
        (b) => b.mediaInfo?.type === "video" && b.mediaInfo?.background
      );
      return { videoBox, desiredVideoUrl: videoBox?.mediaInfo?.background };
    }, [boxes, isDisplay, showBackground, shouldPlayVideo]);

    const [activeVideoUrl, setActiveVideoUrl] = useState<string | undefined>(
      undefined
    );
    const [isWindowVideoLoaded, setIsWindowVideoLoaded] = useState(false);

    const {
      monitorSettings: { showClock, showTimer },
    } = useSelector((state) => state.undoable.present.preferences);

    // Keep the video element mounted and update src only when the URL changes
    useEffect(() => {
      if (desiredVideoUrl && desiredVideoUrl !== activeVideoUrl) {
        setIsWindowVideoLoaded(false);
        setActiveVideoUrl(desiredVideoUrl);
      }
      if (!desiredVideoUrl) {
        // If there is no desired video, clear active video
        setActiveVideoUrl(undefined);
        setIsWindowVideoLoaded(false);
      }
    }, [desiredVideoUrl, activeVideoUrl]);

    return (
      <div
        className={`display-window ${
          showBorder ? "border border-gray-500" : ""
        } ${displayType !== "stream" ? "bg-black" : ""}`}
        ref={containerRef}
        id={isEditor ? "display-editor" : undefined}
        style={{
          width: `${width}vw`,
          height: `${width / aspectRatio}vw`,
        }}
      >
        {isDisplay && showBackground && shouldPlayVideo && activeVideoUrl && (
          <HLSPlayer
            src={activeVideoUrl}
            onLoadedData={() => setIsWindowVideoLoaded(true)}
            onError={() => setIsWindowVideoLoaded(false)}
            videoBox={videoBox}
          />
        )}
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
                isSelected={selectedBox === index}
                isBoxLocked={isBoxLocked?.[index] ?? true}
                disabled={disabled}
              />
            );
          if (isStream)
            return (
              <DisplayStreamText
                key={box.id}
                box={box}
                fontAdjustment={fontAdjustment}
                prevBox={prevBoxes[index]}
                width={width}
                time={time}
                timerInfo={timerInfo}
              />
            );

          if (isDisplay)
            return (
              <DisplayBox
                key={box.id}
                box={box}
                width={width}
                showBackground={showBackground}
                fontAdjustment={fontAdjustment}
                index={index}
                shouldAnimate={shouldAnimate}
                prevBox={prevBoxes[index]}
                time={time}
                timerInfo={timerInfo}
                activeVideoUrl={activeVideoUrl}
                isWindowVideoLoaded={isWindowVideoLoaded}
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
                showBackground={showBackground}
                fontAdjustment={fontAdjustment}
                index={index}
                shouldAnimate={shouldAnimate}
                prevBox={boxes[index]}
                time={time}
                timerInfo={prevTimerInfo}
                activeVideoUrl={activeVideoUrl}
                isWindowVideoLoaded={isWindowVideoLoaded}
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
                timerInfo={prevTimerInfo}
                isPrev
                prevBox={boxes[index]}
              />
            );
          return null;
        })}

        {isDisplay && displayType === "monitor" && (
          <>
            {showClock && (
              <DisplayClock
                width={width}
                fontAdjustment={fontAdjustment}
                time={time}
              />
            )}
            {showTimer && (
              <DisplayTimer
                width={width}
                fontAdjustment={fontAdjustment}
                time={time}
                currentTimerInfo={timerInfo}
              />
            )}
          </>
        )}

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
              prevStbOverlayInfo={prevStbOverlayInfo}
              ref={containerRef}
            />

            <DisplayParticipantOverlay
              width={width}
              shouldAnimate={shouldAnimate}
              participantOverlayInfo={participantOverlayInfo}
              prevParticipantOverlayInfo={prevParticipantOverlayInfo}
              ref={containerRef}
            />

            <DisplayQrCodeOverlay
              width={width}
              shouldAnimate={shouldAnimate}
              qrCodeOverlayInfo={qrCodeOverlayInfo}
              prevQrCodeOverlayInfo={prevQrCodeOverlayInfo}
              ref={containerRef}
            />

            <DisplayImageOverlay
              width={width}
              shouldAnimate={shouldAnimate}
              imageOverlayInfo={imageOverlayInfo}
              prevImageOverlayInfo={prevImageOverlayInfo}
              ref={containerRef}
            />

            <DisplayStreamFormattedText
              width={width}
              shouldAnimate={shouldAnimate}
              formattedTextDisplayInfo={formattedTextDisplayInfo}
              prevFormattedTextDisplayInfo={prevFormattedTextDisplayInfo}
            />
          </>
        )}
      </div>
    );
  }
);

export default DisplayWindow;
