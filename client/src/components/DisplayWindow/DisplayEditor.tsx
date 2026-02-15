import { Box } from "../../types";
import { ChevronsDown, ChevronsUp } from "lucide-react";

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import { Position, ResizableDelta, Rnd } from "react-rnd";
import cn from "classnames";
import { ResizeDirection } from "re-resizable";
import Button from "../Button/Button";
import { useToast } from "../../context/toastContext";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { REFERENCE_WIDTH, REFERENCE_HEIGHT, FONT_SIZE_MULTIPLIER } from "../../constants";

type DraggableData = {
  node: HTMLElement;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  lastX: number;
  lastY: number;
};

type DisplayEditorProps = {
  box: Box;
  width: number;
  onChange?: Function;
  index: number;
  selectBox?: Function;
  isSelected?: boolean;
  isBoxLocked?: boolean;
  disabled?: boolean;
  referenceWidth?: number; // Reference width for coordinate calculations (1920px)
  referenceHeight?: number; // Reference height for coordinate calculations (1080px)
  scaleFactor?: number; // Scale factor applied to parent container (for react-rnd coordinate calculations)
  activeVideoUrl?: string;
  isWindowVideoLoaded?: boolean;
};

const DisplayEditor = ({
  box,
  width,
  onChange,
  selectBox,
  index,
  isSelected,
  isBoxLocked,
  disabled = false,
  referenceWidth = REFERENCE_WIDTH,
  referenceHeight = REFERENCE_HEIGHT,
  scaleFactor = 1,
  activeVideoUrl,
  isWindowVideoLoaded,
}: DisplayEditorProps) => {
  const [boxWidth, setBoxWidth] = useState(`${box.width}%`);
  const [boxHeight, setBoxHeight] = useState(`${box.height}%`);
  const [showOverflow, setShowOverflow] = useState(false);
  const [isTextAreaFocused, setIsTextAreaFocused] = useState(false);
  const lastKeyPressedRef = useRef<string | null>(null);
  const isVideoBg = box.mediaInfo?.type === "video";
  const videoUrl = box.mediaInfo?.background;
  const shouldImageBeHidden = useMemo(
    () =>
      isVideoBg &&
      videoUrl &&
      videoUrl === activeVideoUrl &&
      isWindowVideoLoaded,
    [isVideoBg, videoUrl, activeVideoUrl, isWindowVideoLoaded]
  );
  const rawBackground = isVideoBg
    ? box.mediaInfo?.placeholderImage
    : box.background;
  const background = useCachedMediaUrl(rawBackground);
  let textAreaFocusTimeout: NodeJS.Timeout | null = null;


  const { showToast } = useToast();
  const { isMobile = false } = useContext(ControllerInfoContext) || {};

  const [isOverflowing, setIsOverflowing] = useState(() => {
    const textArea = document.getElementById(`display-editor-${index}`);
    return textArea ? textArea.scrollHeight > textArea.clientHeight : false;
  });

  const [x, setX] = useState(() => {
    // Use reference width for coordinate calculations (matches transform scale)
    return Math.round((referenceWidth * (box.x || 0)) / 100);
  });

  const [y, setY] = useState(() => {
    // Use reference height for coordinate calculations (matches transform scale)
    return Math.round((referenceHeight * (box.y || 0)) / 100);
  });

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const lastToastTimeRef = useRef<number>(0);
  const TOAST_DEBOUNCE_MS = 2000; // Don't show toast again within 2 seconds

  const checkTimerAtCursor = useCallback(() => {
    const textArea = textAreaRef.current;
    if (!textArea || !textArea.value.includes("{{timer}}")) {
      return false;
    }

    const start = textArea.selectionStart;
    const end = textArea.selectionEnd;
    const text = textArea.value;
    const timerPattern = /\{\{timer\}\}/g;
    let match;

    while ((match = timerPattern.exec(text)) !== null) {
      const timerStart = match.index + 1; // Allow cursor on outside of left bracket
      const timerEnd = timerStart + match[0].length - 2; // Allow cursor on outside of right bracket
      // Check if cursor/selection overlaps with timer
      if (
        (start >= timerStart && start <= timerEnd) ||
        (end >= timerStart && end <= timerEnd) ||
        (start <= timerStart && end >= timerEnd)
      ) {
        return true;
      }
    }
    return false;
  }, []);

  const handleTimerInteraction = useCallback(() => {
    const now = Date.now();
    // Debounce to prevent spam
    if (now - lastToastTimeRef.current < TOAST_DEBOUNCE_MS) {
      return;
    }
    lastToastTimeRef.current = now;

    if (textAreaRef.current) {
      textAreaRef.current.blur();
    }
    showToast(
      isMobile
        ? "To edit the timer use the controls in the panel above"
        : "To edit the timer use the controls in the panel to the left",
      "info"
    );
  }, [showToast, isMobile]);

  const checkAndHandleTimer = useCallback(() => {
    requestAnimationFrame(() => {
      if (checkTimerAtCursor()) {
        handleTimerInteraction();
      }
    });
  }, [checkTimerAtCursor, handleTimerInteraction]);

  useEffect(() => {
    if (textAreaRef.current) {
      setIsOverflowing(
        textAreaRef.current?.scrollHeight > textAreaRef.current?.clientHeight
      );
    }
  }, [box, textAreaRef]);

  const updateBoxSize = useCallback(() => {
    // Use reference dimensions for coordinate calculations (matches transform scale)
    const adjustedWidth = (referenceWidth * box.width) / 100;
    const adjustedHeight = (referenceHeight * box.height) / 100;

    setBoxWidth(`${adjustedWidth}px`);
    setBoxHeight(`${adjustedHeight}px`);
  }, [box.width, box.height, referenceWidth, referenceHeight]);

  useEffect(() => {
    updateBoxSize();
  }, [updateBoxSize]);

  const updateBoxXY = useCallback(() => {
    // Use reference dimensions for coordinate calculations (matches transform scale)
    const boxX = box.x || 0;
    const boxY = box.y || 0;

    const adjustedX = Math.round(referenceWidth * (boxX / 100));
    const adjustedY = Math.round(referenceHeight * (boxY / 100));

    setX(adjustedX);
    setY(adjustedY);
  }, [box.x, box.y, referenceWidth, referenceHeight]);

  useEffect(() => {
    updateBoxXY();
  }, [updateBoxXY]);

  const handleDragStop = (e: any, d: DraggableData) => {
    const _x = d.x;
    const _y = d.y;
    setX(_x);
    setY(_y);

    // Use reference dimensions for coordinate calculations (matches transform scale)
    const xPercent = Math.round((_x / referenceWidth) * 100);
    const yPercent = Math.round((_y / referenceHeight) * 100);

    onChange?.({
      index,
      value: words,
      box: { ...box, x: xPercent, y: yPercent },
    });
  };

  const handleResizeStop = (
    e: MouseEvent | TouchEvent,
    dir: ResizeDirection,
    ref: HTMLElement,
    d: ResizableDelta,
    position: Position
  ) => {
    const _width = ref.style.width;
    const _height = ref.style.height;
    const _x = position.x;
    const _y = position.y;

    // Use reference dimensions for coordinate calculations (matches transform scale)
    const widthPercent = Math.round((parseInt(_width) / referenceWidth) * 100);
    const heightPercent = Math.round((parseInt(_height) / referenceHeight) * 100);
    const xPercent = Math.round((_x / referenceWidth) * 100);
    const yPercent = Math.round((_y / referenceHeight) * 100);

    setBoxWidth(_width);
    setBoxHeight(_height);
    setX(_x);
    setY(_y);

    onChange?.({
      index,
      value: words,
      box: {
        ...box,
        x: xPercent,
        y: yPercent,
        width: widthPercent,
        height: heightPercent,
      },
    });
  };

  const rndRef = useCallback(
    (instance: Rnd) => {
      if (instance) {
        const resizeObserver = new ResizeObserver((entries) => {
          updateBoxSize();
          updateBoxXY();
        });
        const element = instance?.getSelfElement();
        if (element) {
          resizeObserver.observe(element);
        }
      }
    },
    [updateBoxSize, updateBoxXY]
  );

  const bFontSize = box.fontSize;
  const words = box.words || "";

  // Convert fontSize to pixels using the font size multiplier
  const fontSizeInPx = bFontSize ? bFontSize * FONT_SIZE_MULTIPLIER : FONT_SIZE_MULTIPLIER;

  const tSS = fontSizeInPx / 32; // text shadow size in px
  const fOS = fontSizeInPx / 128; // font outline size in px

  // Calculate box dimensions in pixels first
  const boxWidthPx = (referenceWidth * box.width) / 100;
  const boxHeightPx = (referenceHeight * box.height) / 100;

  // Convert margins to pixels based on actual box dimensions (after height/width are known)
  const sideMarginPx = box.sideMargin ? (boxWidthPx * box.sideMargin) / 100 : 0;
  const topMarginPx = box.topMargin ? (boxHeightPx * box.topMargin) / 100 : 0;

  const marginLeft = `${sideMarginPx}px`;
  const marginRight = `${sideMarginPx}px`;
  const marginTop = `${topMarginPx}px`;
  const marginBottom = `${topMarginPx}px`;

  const textBoxWidth = `${boxWidthPx - sideMarginPx * 2}px`;
  const textBoxHeight = `${boxHeightPx - topMarginPx * 2}px`;
  const textStyles = {
    textShadow: `${tSS}px ${tSS}px ${tSS}px #000, ${tSS}px ${tSS}px ${tSS}px #000`,
    WebkitTextStroke: `${fOS}px #000`,
    textAlign: box.align || "center",
    lineHeight: 1.25,
    fontSize: `${fontSizeInPx}px`,
    color: box.fontColor,
    fontWeight: box.isBold ? "bold" : "normal",
    fontStyle: box.isItalic ? "italic" : "normal",
  };

  return (
    <Rnd
      size={{ width: boxWidth, height: boxHeight }}
      className={cn(
        (!isBoxLocked || isSelected) &&
        "outline-1 outline-gray-300 -outline-offset-2",
        isSelected && !box.background && "z-10"
      )}
      position={{ x, y }}
      scale={scaleFactor}
      disableDragging={isBoxLocked || disabled}
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      minWidth={`${(referenceWidth * 7.5) / 100}px`}
      minHeight={`${(referenceHeight * 7.5) / 100}px`}
      maxHeight={`${referenceHeight}px`}
      maxWidth={`${referenceWidth}px`}
      resizeGrid={[5, 5]}
      dragGrid={[5, 5]}
      bounds={"parent"}
      ref={rndRef}
      onClick={() => selectBox?.(index)}
      enableUserSelectHack={!isBoxLocked && !disabled}
      enableResizing={{
        top: !isBoxLocked && !disabled,
        topLeft: !isBoxLocked && !disabled,
        topRight: !isBoxLocked && !disabled,
        bottom: !isBoxLocked && !disabled,
        bottomLeft: !isBoxLocked && !disabled,
        bottomRight: !isBoxLocked && !disabled,
        left: !isBoxLocked && !disabled,
        right: !isBoxLocked && !disabled,
      }}
    >
      {background && (
        <img
          className={cn(
            "display-box-background h-full w-full absolute",
            box.shouldKeepAspectRatio && "object-contain",
            shouldImageBeHidden ? "opacity-0" : "opacity-100"
          )}
          style={{
            filter: `brightness(${box.brightness}%)`,
          }}
          src={background}
          alt={box.label}
        />
      )}
      {typeof onChange === "function" && index !== 0 && (
        <>
          <textarea
            className={cn(
              "h-full w-full bg-transparent absolute resize-none [scrollbar-width:none]",
              showOverflow ? "overflow-y-visible" : "overflow-y-clip"
            )}
            id={`display-editor-box-${index}`}
            ref={textAreaRef}
            value={words}
            disabled={disabled}
            style={{
              marginTop,
              marginBottom,
              marginLeft,
              marginRight,
              width: textBoxWidth,
              height: textBoxHeight,
              ...textStyles,
            }}
            onFocus={() => {
              if (textAreaFocusTimeout) {
                clearTimeout(textAreaFocusTimeout);
              }
              setIsTextAreaFocused(true);
            }}
            onBlur={() => {
              textAreaFocusTimeout = setTimeout(() => {
                setIsTextAreaFocused(false);
              }, 500);
            }}
            onChange={(e) => {
              e.preventDefault();
              onChange({
                index,
                value: e.target.value,
                box,
                cursorPosition: e.target.selectionStart,
                lastKeyPressed: lastKeyPressedRef.current,
              });
            }}
            onKeyUp={(e) => {
              lastKeyPressedRef.current = e.key;
              // Check after cursor movement keys
              if (
                [
                  "ArrowLeft",
                  "ArrowRight",
                  "ArrowUp",
                  "ArrowDown",
                  "Home",
                  "End",
                ].includes(e.key)
              ) {
                checkAndHandleTimer();
              }
            }}
            onSelect={checkAndHandleTimer}
            onMouseUp={(e) => {
              e.stopPropagation();
              checkAndHandleTimer();
            }}
          />
          {isOverflowing && isTextAreaFocused && (
            <Button
              variant="tertiary"
              onFocus={() => {
                if (textAreaFocusTimeout) {
                  clearTimeout(textAreaFocusTimeout);
                }
                setIsTextAreaFocused(true);
              }}
              onBlur={() => setIsTextAreaFocused(false)}
              svg={showOverflow ? ChevronsUp : ChevronsDown}
              onClick={() => setShowOverflow(!showOverflow)}
              className={"absolute bottom-0 left-1/2 border-b-cyan-400"}
              color="#67e8f9"
            />
          )}
        </>
      )}
    </Rnd>
  );
};

export default DisplayEditor;
