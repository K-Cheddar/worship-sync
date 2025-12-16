import { Box } from "../../types";
import { ChevronsDown, ChevronsUp } from "lucide-react";

import { useCallback, useEffect, useRef, useState } from "react";
import { Position, ResizableDelta, Rnd } from "react-rnd";
import cn from "classnames";
import { ResizeDirection } from "re-resizable";
import Button from "../Button/Button";
import { useToast } from "../../context/toastContext";

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
  fontAdjustment: number;
  onChange?: Function;
  index: number;
  selectBox?: Function;
  isSelected?: boolean;
  isBoxLocked?: boolean;
  disabled?: boolean;
};

const DisplayEditor = ({
  box,
  width,
  fontAdjustment,
  onChange,
  selectBox,
  index,
  isSelected,
  isBoxLocked,
  disabled = false,
}: DisplayEditorProps) => {
  const [boxWidth, setBoxWidth] = useState(`${box.width}%`);
  const [boxHeight, setBoxHeight] = useState(`${box.height}%`);
  const [showOverflow, setShowOverflow] = useState(false);
  const [isTextAreaFocused, setIsTextAreaFocused] = useState(false);
  const lastKeyPressedRef = useRef<string | null>(null);
  const isVideoBg = box.mediaInfo?.type === "video";
  const background = isVideoBg
    ? box.mediaInfo?.placeholderImage
    : box.background;
  let textAreaFocusTimeout: NodeJS.Timeout | null = null;

  const { showToast } = useToast();

  const [isOverflowing, setIsOverflowing] = useState(() => {
    const textArea = document.getElementById(`display-editor-${index}`);
    return textArea ? textArea.scrollHeight > textArea.clientHeight : false;
  });

  const [x, setX] = useState(() => {
    const parent = document.getElementById("display-editor");
    const width = parent?.offsetWidth || 0;
    return Math.round((width * (box.x || 0)) / 100);
  });

  const [y, setY] = useState(() => {
    const parent = document.getElementById("display-editor");
    const height = parent?.offsetHeight || 0;
    return Math.round((height * (box.y || 0)) / 100);
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
    showToast("To edit the timer use the Timer Manager above", "info");
  }, [showToast]);

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
    const parent = document.getElementById("display-editor");
    const width = parent?.offsetWidth || 0;
    const height = parent?.offsetHeight || 0;
    const adjustedWidth = (width * box.width) / 100;
    const adjustedHeight = (height * box.height) / 100;

    setBoxWidth(`${adjustedWidth}px`);
    setBoxHeight(`${adjustedHeight}px`);
  }, [box.width, box.height]);

  useEffect(() => {
    updateBoxSize();
  }, [updateBoxSize]);

  const updateBoxXY = useCallback(() => {
    const parent = document.getElementById("display-editor");
    const boxX = box.x || 0;
    const boxY = box.y || 0;
    const width = parent?.offsetWidth || 0;
    const height = parent?.offsetHeight || 0;

    const adjustedX = Math.round(width * (boxX / 100));
    const adjustedY = Math.round(height * (boxY / 100));

    setX(adjustedX);
    setY(adjustedY);
  }, [box.x, box.y]);

  useEffect(() => {
    updateBoxXY();
  }, [updateBoxXY]);

  const handleDragStop = (e: any, d: DraggableData) => {
    const _x = d.x;
    const _y = d.y;
    setX(_x);
    setY(_y);

    const parent = document.getElementById("display-editor");
    const currentWidth = parent?.offsetWidth || 0;
    const currentHeight = parent?.offsetHeight || 0;
    const xPercent = Math.round((_x / currentWidth) * 100);
    const yPercent = Math.round((_y / currentHeight) * 100);

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

    const parent = document.getElementById("display-editor");
    const currentWidth = parent?.offsetWidth || 0;
    const currentHeight = parent?.offsetHeight || 0;
    const widthPercent = Math.round((parseInt(_width) / currentWidth) * 100);
    const heightPercent = Math.round((parseInt(_height) / currentHeight) * 100);
    const xPercent = Math.round((_x / currentWidth) * 100);
    const yPercent = Math.round((_y / currentHeight) * 100);

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
  const fontSizeValue = bFontSize ? bFontSize / fontAdjustment : 1;
  const tSS = fontSizeValue / (width > 20 ? 32 : 10); // text shadow size
  const fOS = fontSizeValue / (width > 20 ? 32 : 114); // font outline size
  const marginLeft = `${box.sideMargin}%`;
  const marginRight = `${box.sideMargin}%`;
  const marginTop = `${box.topMargin}%`;
  const marginBottom = `${box.topMargin}%`;
  const textBoxWidth = `calc(100% - ${
    box.sideMargin ? box.sideMargin * 2 : 0
  }%)`;
  // % margin is calculated based on the width so we get the percentage of top and bottom margin, then multiply by the width of the container
  const textBoxHeight = `calc(100% - (${width}vw * (${box.topMargin || 0} + ${
    box.topMargin || 0
  }) / 100) )`;
  const textStyles = {
    textShadow: `${tSS}vw ${tSS}vw ${tSS}vw #000, ${tSS}vw ${tSS}vw ${tSS}vw #000`,
    WebkitTextStroke: `${fOS}vw #000`,
    textAlign: box.align || "center",
    lineHeight: 1.25,
    fontSize: `${fontSizeValue}vw`,
    color: box.fontColor,
    fontWeight: box.isBold ? "bold" : "normal",
    fontStyle: box.isItalic ? "italic" : "normal",
  };
  return (
    <Rnd
      size={{ width: boxWidth, height: boxHeight }}
      className={cn(
        (!isBoxLocked || isSelected) &&
          "outline outline-1 outline-gray-300 -outline-offset-2",
        isSelected && !box.background && "z-10"
      )}
      position={{ x, y }}
      disableDragging={isBoxLocked || disabled}
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      minWidth={"7.5%"}
      minHeight={"7.5%"}
      maxHeight={"100%"}
      maxWidth={"100%"}
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
            "display-box-background",
            box.shouldKeepAspectRatio && "object-contain"
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
              className={"absolute bottom-0 left-1/2"}
            />
          )}
        </>
      )}
    </Rnd>
  );
};

export default DisplayEditor;
