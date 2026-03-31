import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Position, ResizableDelta, Rnd } from "react-rnd";
import { ResizeDirection } from "re-resizable";
import { ChevronsDown, ChevronsUp } from "lucide-react";
import cn from "classnames";

import { Box } from "../../types";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import Button from "../Button/Button";
import { useToast } from "../../context/toastContext";
import { ControllerInfoContext } from "../../context/controllerInfo";
import {
  DEFAULT_FONT_PX,
  REFERENCE_HEIGHT,
  REFERENCE_WIDTH,
} from "../../constants";
import { resolveFormattedCursorPosition } from "../../utils/cursorPosition";

type DraggableData = {
  node: HTMLElement;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  lastX: number;
  lastY: number;
};

export type DisplayEditorChangeInfo = {
  index: number;
  value: string;
  box: Box;
  cursorPosition?: number;
  lastKeyPressed?: string | null;
  commitMode?: "typing" | "flush" | "immediate";
};

type DisplayEditorProps = {
  box: Box;
  width: number;
  onChange?: (info: DisplayEditorChangeInfo) => void;
  index: number;
  selectBox?: (index: number) => void;
  isSelected?: boolean;
  isBoxLocked?: boolean;
  disabled?: boolean;
  referenceWidth?: number;
  referenceHeight?: number;
  scaleFactor?: number;
  activeVideoUrl?: string;
  isWindowVideoLoaded?: boolean;
  desiredCursorPosition?: number;
};

const DisplayEditorComponent = ({
  box,
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
  desiredCursorPosition,
}: DisplayEditorProps) => {
  const [boxWidth, setBoxWidth] = useState(`${box.width}%`);
  const [boxHeight, setBoxHeight] = useState(`${box.height}%`);
  const [showOverflow, setShowOverflow] = useState(false);
  const [isTextAreaFocused, setIsTextAreaFocused] = useState(false);
  const [draftWords, setDraftWords] = useState(box.words || "");
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [x, setX] = useState(() =>
    Math.round((referenceWidth * (box.x || 0)) / 100)
  );
  const [y, setY] = useState(() =>
    Math.round((referenceHeight * (box.y || 0)) / 100)
  );

  const words = box.words || "";
  const fontSizeInPx = box.fontSize ?? DEFAULT_FONT_PX;
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const textAreaFocusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastKeyPressedRef = useRef<string | null>(null);
  const lastToastTimeRef = useRef<number>(0);
  const lastBoxRef = useRef(box);
  const lastPropWordsRef = useRef(words);
  const rndResizeObserverRef = useRef<ResizeObserver | null>(null);
  const isVideoBg = box.mediaInfo?.type === "video";
  const videoUrl = box.mediaInfo?.background;
  const rawBackground = isVideoBg
    ? box.mediaInfo?.placeholderImage
    : box.background;
  const background = useCachedMediaUrl(rawBackground);
  const { showToast } = useToast();
  const { isMobile = false } = useContext(ControllerInfoContext) || {};
  const TOAST_DEBOUNCE_MS = 2000;

  const shouldImageBeHidden = useMemo(
    () =>
      isVideoBg &&
      videoUrl &&
      videoUrl === activeVideoUrl &&
      isWindowVideoLoaded,
    [isVideoBg, videoUrl, activeVideoUrl, isWindowVideoLoaded]
  );

  const anchorScrollToTop = useCallback(() => {
    const textArea = textAreaRef.current;
    if (!textArea || showOverflow) {
      return;
    }

    const resetScroll = () => {
      if (!textAreaRef.current || showOverflow) {
        return;
      }
      textAreaRef.current.scrollTop = 0;
      textAreaRef.current.scrollLeft = 0;
    };

    resetScroll();
    requestAnimationFrame(resetScroll);
  }, [showOverflow]);

  const syncDraftToWords = useCallback((
    nextWords: string,
    options?: { preserveCursor?: boolean; cursorPosition?: number }
  ) => {
    if (textAreaRef.current) {
      const previousValue = textAreaRef.current.value;
      const previousSelection =
        textAreaRef.current.selectionStart ?? previousValue.length;
      const nextCursorPosition = typeof options?.cursorPosition === "number"
        ? Math.min(options.cursorPosition, nextWords.length)
        : options?.preserveCursor
        ? resolveFormattedCursorPosition(previousValue, nextWords, previousSelection)
        : Math.min(previousSelection, nextWords.length);

      if (textAreaRef.current.value !== nextWords) {
        textAreaRef.current.value = nextWords;
      }
      textAreaRef.current.selectionStart = nextCursorPosition;
      textAreaRef.current.selectionEnd = nextCursorPosition;
    }
    setDraftWords(nextWords);
    anchorScrollToTop();
  }, [anchorScrollToTop]);

  useLayoutEffect(() => {
    const boxChanged = box !== lastBoxRef.current;
    if (boxChanged) {
      lastBoxRef.current = box;
    }

    const cursorPosition = isTextAreaFocused ? desiredCursorPosition : undefined;

    if (words !== lastPropWordsRef.current) {
      lastPropWordsRef.current = words;
      syncDraftToWords(words, {
        preserveCursor: isTextAreaFocused,
        cursorPosition,
      });
      return;
    }

    if (boxChanged && draftWords !== words) {
      syncDraftToWords(words, {
        preserveCursor: isTextAreaFocused,
        cursorPosition,
      });
      return;
    }

    if (!isTextAreaFocused && draftWords !== words) {
      syncDraftToWords(words);
    }
  }, [
    box,
    desiredCursorPosition,
    draftWords,
    isTextAreaFocused,
    syncDraftToWords,
    words,
  ]);

  useLayoutEffect(() => {
    if (isTextAreaFocused) {
      anchorScrollToTop();
    }
  }, [anchorScrollToTop, draftWords, isTextAreaFocused]);

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
      const timerStart = match.index + 1;
      const timerEnd = timerStart + match[0].length - 2;

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

  const updateBoxSize = useCallback(() => {
    const adjustedWidth = (referenceWidth * box.width) / 100;
    const adjustedHeight = (referenceHeight * box.height) / 100;

    setBoxWidth(`${adjustedWidth}px`);
    setBoxHeight(`${adjustedHeight}px`);
  }, [box.width, box.height, referenceWidth, referenceHeight]);

  useEffect(() => {
    updateBoxSize();
  }, [updateBoxSize]);

  const updateBoxXY = useCallback(() => {
    const adjustedX = Math.round(referenceWidth * ((box.x || 0) / 100));
    const adjustedY = Math.round(referenceHeight * ((box.y || 0) / 100));

    setX(adjustedX);
    setY(adjustedY);
  }, [box.x, box.y, referenceWidth, referenceHeight]);

  useEffect(() => {
    updateBoxXY();
  }, [updateBoxXY]);

  const boxWidthPx = (referenceWidth * box.width) / 100;
  const boxHeightPx = (referenceHeight * box.height) / 100;
  const sideMarginPx = box.sideMargin ? (boxWidthPx * box.sideMargin) / 100 : 0;
  const topMarginPx = box.topMargin ? (boxHeightPx * box.topMargin) / 100 : 0;

  const marginLeft = `${sideMarginPx}px`;
  const marginRight = `${sideMarginPx}px`;
  const marginTop = `${topMarginPx}px`;
  const marginBottom = `${topMarginPx}px`;
  const textBoxWidth = `${boxWidthPx - sideMarginPx * 2}px`;
  const textBoxHeight = `${boxHeightPx - topMarginPx * 2}px`;
  const tSS = fontSizeInPx / 32;

  const textStyles = {
    textShadow: `${tSS}px ${tSS}px ${tSS}px #000, ${tSS}px ${tSS}px ${tSS}px #000`,
    textAlign: box.align || "center",
    lineHeight: 1.25,
    fontSize: `${fontSizeInPx}px`,
    color: box.fontColor,
    fontWeight: box.isBold ? "bold" : "normal",
    fontStyle: box.isItalic ? "italic" : "normal",
  };

  useEffect(() => {
    if (!textAreaRef.current) return;

    setIsOverflowing(
      textAreaRef.current.scrollHeight > textAreaRef.current.clientHeight
    );
  }, [draftWords, textBoxHeight, textBoxWidth, fontSizeInPx]);

  const emitChange = useCallback(
    ({
      value,
      boxOverride,
      commitMode,
      cursorPosition,
    }: {
      value: string;
      boxOverride?: Partial<Box>;
      commitMode: DisplayEditorChangeInfo["commitMode"];
      cursorPosition?: number;
    }) => {
      onChange?.({
        index,
        value,
        box: {
          ...box,
          words: value,
          ...boxOverride,
        },
        cursorPosition,
        lastKeyPressed: lastKeyPressedRef.current,
        commitMode,
      });
    },
    [box, index, onChange]
  );

  const flushDraftChange = useCallback(() => {
    const cursorPosition = textAreaRef.current?.selectionStart;
    if (draftWords === words) {
      return;
    }

    emitChange({
      value: draftWords,
      commitMode: "flush",
      cursorPosition,
    });
  }, [draftWords, emitChange, words]);

  const handleDragStop = (_e: unknown, d: DraggableData) => {
    const nextX = d.x;
    const nextY = d.y;
    setX(nextX);
    setY(nextY);

    emitChange({
      value: draftWords,
      commitMode: "immediate",
      boxOverride: {
        x: Math.round((nextX / referenceWidth) * 100),
        y: Math.round((nextY / referenceHeight) * 100),
      },
    });
  };

  const handleResizeStop = (
    _e: MouseEvent | TouchEvent,
    _dir: ResizeDirection,
    ref: HTMLElement,
    _d: ResizableDelta,
    position: Position
  ) => {
    const nextWidth = ref.style.width;
    const nextHeight = ref.style.height;
    const nextX = position.x;
    const nextY = position.y;

    setBoxWidth(nextWidth);
    setBoxHeight(nextHeight);
    setX(nextX);
    setY(nextY);

    emitChange({
      value: draftWords,
      commitMode: "immediate",
      boxOverride: {
        width: Math.round((parseInt(nextWidth, 10) / referenceWidth) * 100),
        height: Math.round((parseInt(nextHeight, 10) / referenceHeight) * 100),
        x: Math.round((nextX / referenceWidth) * 100),
        y: Math.round((nextY / referenceHeight) * 100),
      },
    });
  };

  const rndRef = useCallback(
    (instance: Rnd | null) => {
      if (rndResizeObserverRef.current) {
        rndResizeObserverRef.current.disconnect();
        rndResizeObserverRef.current = null;
      }

      if (!instance) return;

      const element = instance.getSelfElement();
      if (!element) return;

      const resizeObserver = new ResizeObserver(() => {
        updateBoxSize();
        updateBoxXY();
      });
      rndResizeObserverRef.current = resizeObserver;
      resizeObserver.observe(element);
    },
    [updateBoxSize, updateBoxXY]
  );

  useEffect(() => {
    return () => {
      if (textAreaFocusTimeoutRef.current) {
        clearTimeout(textAreaFocusTimeoutRef.current);
      }
      if (rndResizeObserverRef.current) {
        rndResizeObserverRef.current.disconnect();
        rndResizeObserverRef.current = null;
      }
    };
  }, []);

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
      bounds="parent"
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
            value={draftWords}
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
              if (textAreaFocusTimeoutRef.current) {
                clearTimeout(textAreaFocusTimeoutRef.current);
              }
              setIsTextAreaFocused(true);
            }}
            onBlur={() => {
              flushDraftChange();
              textAreaFocusTimeoutRef.current = setTimeout(() => {
                setIsTextAreaFocused(false);
              }, 500);
            }}
            onChange={(e) => {
              const nextValue = e.target.value;
              setDraftWords(nextValue);
              emitChange({
                value: nextValue,
                commitMode: "typing",
                cursorPosition: e.target.selectionStart,
              });
              anchorScrollToTop();
            }}
            onKeyDown={(e) => {
              lastKeyPressedRef.current = e.key;
            }}
            onKeyUp={(e) => {
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
            onScroll={() => anchorScrollToTop()}
          />
          {isOverflowing && isTextAreaFocused && (
            <Button
              variant="tertiary"
              onFocus={() => {
                if (textAreaFocusTimeoutRef.current) {
                  clearTimeout(textAreaFocusTimeoutRef.current);
                }
                setIsTextAreaFocused(true);
              }}
              onBlur={() => setIsTextAreaFocused(false)}
              svg={showOverflow ? ChevronsUp : ChevronsDown}
              onClick={() => setShowOverflow(!showOverflow)}
              className="absolute bottom-0 left-1/2 border-b-cyan-400"
              color="#67e8f9"
            />
          )}
        </>
      )}
    </Rnd>
  );
};

const areDisplayEditorPropsEqual = (
  prevProps: DisplayEditorProps,
  nextProps: DisplayEditorProps
) =>
  prevProps.box === nextProps.box &&
  prevProps.width === nextProps.width &&
  prevProps.index === nextProps.index &&
  prevProps.isSelected === nextProps.isSelected &&
  prevProps.isBoxLocked === nextProps.isBoxLocked &&
  prevProps.disabled === nextProps.disabled &&
  prevProps.referenceWidth === nextProps.referenceWidth &&
  prevProps.referenceHeight === nextProps.referenceHeight &&
  prevProps.scaleFactor === nextProps.scaleFactor &&
  prevProps.activeVideoUrl === nextProps.activeVideoUrl &&
  prevProps.isWindowVideoLoaded === nextProps.isWindowVideoLoaded &&
  prevProps.desiredCursorPosition === nextProps.desiredCursorPosition;

const DisplayEditor = memo(DisplayEditorComponent, areDisplayEditorPropsEqual);

DisplayEditor.displayName = "DisplayEditor";

export default DisplayEditor;
