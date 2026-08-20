import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Minus, Maximize2, X } from "lucide-react";
import Button from "../Button/Button";
import { cn } from "@/utils/cnHelper";
import {
  useFloatingWindowBringToFront,
  useFloatingWindowManager,
} from "./FloatingWindowZIndexContext";

const TITLE_BAR_HEIGHT = 40;
const MIN_WIDTH = 200;
const MIN_HEIGHT = TITLE_BAR_HEIGHT + 60;
const ANIM_MS = 180;
const TITLE_BAR_CONTROL_CLASS =
  "max-md:!min-h-8 max-md:!min-w-8 max-md:p-1 touch-manipulation";
/** Coarse hit areas stay near the border so they do not cover content buttons. */
const BOTTOM_EDGE_RESIZE_CLASS =
  "absolute bottom-0 left-12 right-12 z-10 h-1 cursor-ns-resize pointer-coarse:h-3";
const BOTTOM_CORNER_RESIZE_CLASS =
  "absolute bottom-0 z-10 h-3 w-3 pointer-coarse:h-4 pointer-coarse:w-4";
const SIDE_EDGE_RESIZE_CLASS =
  "absolute top-10 bottom-12 z-10 w-1.5 cursor-ew-resize pointer-coarse:w-3";

const isTitleBarControlTarget = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("button"));

/** Keep floating windows inside the viewport — never larger than the screen. */
const clampSizeToViewport = (width: number, height: number) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    width: Math.min(Math.max(width, Math.min(MIN_WIDTH, vw)), vw),
    height: Math.min(Math.max(height, Math.min(MIN_HEIGHT, vh)), vh),
  };
};

export interface FloatingWindowHandle {
  restore: () => void;
}

interface FloatingWindowProps {
  title: React.ReactNode;
  /**
   * Short label for the multi-window dock. Defaults to `title` when it is a string.
   */
  label?: string;
  children: React.ReactNode;
  onClose: () => void;
  defaultPosition?: { x: number; y: number };
  defaultWidth?: number;
  defaultHeight?: number;
  /** When true, height grows with content up to defaultHeight instead of being fixed. */
  autoHeight?: boolean;
  contentClassName?: string;
  className?: string;
  initiallyMinimized?: boolean;
}

/**
 * Animation state machine:
 *   opening   → content expanding from bottom on mount
 *   open      → normal idle state
 *   minimizing → content collapsing up toward title bar
 *   minimized  → content hidden, only title bar visible
 *   restoring  → content expanding back down from title bar
 *   closing    → whole window shrinks to bottom + fades, then onClose fires
 */
type AnimPhase =
  | "opening"
  | "open"
  | "minimizing"
  | "minimized"
  | "restoring"
  | "closing";

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const FloatingWindow = forwardRef<FloatingWindowHandle, FloatingWindowProps>(
  function FloatingWindow(
    {
      title,
      label,
      children,
      onClose,
      defaultPosition,
      defaultWidth = 400,
      defaultHeight = 300,
      autoHeight = false,
      contentClassName,
      className,
      initiallyMinimized = false,
    },
    ref,
  ) {
    const windowId = useId();
    const dockLabel =
      label?.trim() ||
      (typeof title === "string" && title.trim() ? title.trim() : "Window");

    const [size, setSize] = useState(() =>
      clampSizeToViewport(defaultWidth, defaultHeight),
    );
    const [userResized, setUserResized] = useState(false);
    const sizeRef = useRef(size);
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      sizeRef.current = size;
    }, [size]);

    const [position, setPosition] = useState(() => {
      const clampedSize = clampSizeToViewport(defaultWidth, defaultHeight);
      const p = defaultPosition ?? {
        x: (window.innerWidth - clampedSize.width) / 2,
        y: (window.innerHeight - clampedSize.height) / 2,
      };
      return {
        x: Math.min(Math.max(p.x, 0), Math.max(window.innerWidth - clampedSize.width, 0)),
        y: autoHeight
          ? Math.max(p.y, 0)
          : Math.min(
            Math.max(p.y, 0),
            Math.max(window.innerHeight - clampedSize.height, 0),
          ),
      };
    });
    const positionRef = useRef(position);
    useEffect(() => {
      positionRef.current = position;
    }, [position]);

    const [minimizedY, setMinimizedY] = useState(() => window.innerHeight - TITLE_BAR_HEIGHT);
    const minimizedYRef = useRef(minimizedY);
    useEffect(() => {
      minimizedYRef.current = minimizedY;
    }, [minimizedY]);

    const autoHeightRef = useRef(autoHeight);
    const bringToFront = useFloatingWindowBringToFront();
    const { register, update, setFrontmost } = useFloatingWindowManager();
    // Fresh top z-index on mount so new windows open above existing ones.
    const [activeZ, setActiveZ] = useState(() => bringToFront());

    const raiseWindow = useCallback(() => {
      // Skip setState when already frontmost — a re-render during touchstart
      // cancels the browser's synthesized click on touch devices.
      setActiveZ((current) => bringToFront(current));
      setFrontmost(windowId);
    }, [bringToFront, setFrontmost, windowId]);

    // ── Animation state ──────────────────────────────────────────────────────
    const [phase, setPhase] = useState<AnimPhase>(
      initiallyMinimized ? "minimized" : "opening",
    );
    const phaseRef = useRef(phase);
    phaseRef.current = phase;
    const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearAnimTimer = () => {
      if (animTimerRef.current) {
        clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
    };

    // After mounting in "opening" phase, advance to "open" on next frame so
    // the CSS transition from the compressed state plays.
    useLayoutEffect(() => {
      if (phase !== "opening") return;
      const raf = requestAnimationFrame(() => setPhase("open"));
      return () => cancelAnimationFrame(raf);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleMinimize = useCallback(() => {
      clearAnimTimer();
      const current = phaseRef.current;
      if (current === "minimized" || current === "minimizing") {
        // Restore: show content collapsed first (instant), then expand
        setPhase("restoring");
        // One frame at the collapsed position so CSS transition fires
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setPhase("open");
          });
        });
      } else {
        setMinimizedY(window.innerHeight - TITLE_BAR_HEIGHT);
        setPhase("minimizing");
        animTimerRef.current = setTimeout(() => setPhase("minimized"), ANIM_MS);
      }
    }, []);

    const focusWindow = useCallback(() => {
      raiseWindow();
      if (phaseRef.current === "minimized" || phaseRef.current === "minimizing") {
        handleMinimize();
      }
    }, [handleMinimize, raiseWindow]);

    const handleClose = useCallback(() => {
      clearAnimTimer();
      setPhase("closing");
      animTimerRef.current = setTimeout(() => onClose(), ANIM_MS);
    }, [onClose]);

    useEffect(() => () => clearAnimTimer(), []);

    useEffect(() => {
      setFrontmost(windowId);
      return register({
        id: windowId,
        label: dockLabel,
        isMinimized: initiallyMinimized,
        focus: focusWindow,
      });
    }, [windowId]); // eslint-disable-line react-hooks/exhaustive-deps -- register once per mount

    useEffect(() => {
      update(windowId, {
        label: dockLabel,
        isMinimized: phase === "minimized" || phase === "minimizing",
        focus: focusWindow,
      });
    }, [dockLabel, focusWindow, phase, update, windowId]);

    useImperativeHandle(
      ref,
      () => ({
        restore: () => {
          if (phaseRef.current === "minimized" || phaseRef.current === "minimizing") {
            handleMinimize();
          }
        },
      }),
      [handleMinimize],
    );

    // ── Drag ─────────────────────────────────────────────────────────────────
    const dragState = useRef<{
      isDragging: boolean;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }>({ isDragging: false, startX: 0, startY: 0, originX: 0, originY: 0 });

    const isMinimizedRef = useRef(false);
    isMinimizedRef.current = phase === "minimized";

    const clampPosition = useCallback((x: number, y: number) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h =
        isMinimizedRef.current || autoHeightRef.current
          ? TITLE_BAR_HEIGHT
          : sizeRef.current.height;
      return {
        x: Math.min(Math.max(x, 0), Math.max(vw - sizeRef.current.width, 0)),
        y: Math.min(Math.max(y, 0), Math.max(vh - h, 0)),
      };
    }, []);

    // Keep size/position inside the viewport when the browser window resizes.
    useEffect(() => {
      const onViewportResize = () => {
        const nextSize = clampSizeToViewport(
          sizeRef.current.width,
          sizeRef.current.height,
        );
        sizeRef.current = nextSize;
        setSize((prev) =>
          prev.width === nextSize.width && prev.height === nextSize.height
            ? prev
            : nextSize,
        );

        const nextPos = clampPosition(positionRef.current.x, positionRef.current.y);
        positionRef.current = nextPos;
        setPosition((prev) =>
          prev.x === nextPos.x && prev.y === nextPos.y ? prev : nextPos,
        );

        const dockY = window.innerHeight - TITLE_BAR_HEIGHT;
        setMinimizedY((prev) => Math.min(prev, dockY));
        minimizedYRef.current = Math.min(minimizedYRef.current, dockY);
      };

      window.addEventListener("resize", onViewportResize);
      return () => window.removeEventListener("resize", onViewportResize);
    }, [clampPosition]);

    const setGestureTransition = useCallback((active: boolean) => {
      if (containerRef.current) {
        containerRef.current.style.transition = active ? "none" : "";
      }
    }, []);

    const applyDragPosition = useCallback(
      (clientX: number, clientY: number) => {
        if (!dragState.current.isDragging) return;
        const dx = clientX - dragState.current.startX;
        const dy = clientY - dragState.current.startY;
        const pos = clampPosition(dragState.current.originX + dx, dragState.current.originY + dy);
        positionRef.current = pos;
        if (containerRef.current) {
          containerRef.current.style.left = `${pos.x}px`;
          containerRef.current.style.top = `${pos.y}px`;
        }
      },
      [clampPosition],
    );

    const handleDragMouseMove = useCallback(
      (e: MouseEvent) => applyDragPosition(e.clientX, e.clientY),
      [applyDragPosition],
    );

    const handleDragMouseUp = useCallback(() => {
      dragState.current.isDragging = false;
      setGestureTransition(false);
      if (isMinimizedRef.current) {
        setPosition((prev) => ({ ...prev, x: positionRef.current.x }));
        setMinimizedY(positionRef.current.y);
      } else {
        setPosition({ ...positionRef.current });
      }
      document.removeEventListener("mousemove", handleDragMouseMove);
      document.removeEventListener("mouseup", handleDragMouseUp);
    }, [handleDragMouseMove, setGestureTransition]);

    const handleTitleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (isTitleBarControlTarget(e.target)) return;
        e.preventDefault();
        dragState.current = {
          isDragging: true,
          startX: e.clientX,
          startY: e.clientY,
          originX: positionRef.current.x,
          originY: isMinimizedRef.current ? minimizedYRef.current : positionRef.current.y,
        };
        setGestureTransition(true);
        document.addEventListener("mousemove", handleDragMouseMove);
        document.addEventListener("mouseup", handleDragMouseUp);
      },
      [handleDragMouseMove, handleDragMouseUp, setGestureTransition],
    );

    const handleDragTouchMove = useCallback(
      (e: TouchEvent) => {
        if (!dragState.current.isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        applyDragPosition(touch.clientX, touch.clientY);
      },
      [applyDragPosition],
    );

    const handleDragTouchEnd = useCallback(() => {
      dragState.current.isDragging = false;
      setGestureTransition(false);
      if (isMinimizedRef.current) {
        setPosition((prev) => ({ ...prev, x: positionRef.current.x }));
        setMinimizedY(positionRef.current.y);
      } else {
        setPosition({ ...positionRef.current });
      }
      document.removeEventListener("touchmove", handleDragTouchMove);
      document.removeEventListener("touchend", handleDragTouchEnd);
    }, [handleDragTouchMove, setGestureTransition]);

    const handleTitleTouchStart = useCallback(
      (e: React.TouchEvent) => {
        if (isTitleBarControlTarget(e.target)) return;
        const touch = e.touches[0];
        dragState.current = {
          isDragging: true,
          startX: touch.clientX,
          startY: touch.clientY,
          originX: positionRef.current.x,
          originY: isMinimizedRef.current ? minimizedYRef.current : positionRef.current.y,
        };
        setGestureTransition(true);
        document.addEventListener("touchmove", handleDragTouchMove, { passive: false });
        document.addEventListener("touchend", handleDragTouchEnd);
      },
      [handleDragTouchMove, handleDragTouchEnd, setGestureTransition],
    );

    /** Keep title controls from starting a drag or raising (re-render) mid-tap. */
    const stopTitleControlGesture = useCallback((e: React.SyntheticEvent) => {
      e.stopPropagation();
    }, []);

    // ── Resize ───────────────────────────────────────────────────────────────
    const resizeState = useRef<{
      isResizing: boolean;
      direction: ResizeDirection;
      startX: number;
      startY: number;
      startWidth: number;
      startHeight: number;
      startPosX: number;
      startPosY: number;
    }>({
      isResizing: false,
      direction: "se",
      startX: 0,
      startY: 0,
      startWidth: 0,
      startHeight: 0,
      startPosX: 0,
      startPosY: 0,
    });

    const prepareResizeGesture = useCallback(() => {
      if (!autoHeightRef.current || userResized) {
        return {
          width: sizeRef.current.width,
          height: sizeRef.current.height,
        };
      }

      const el = containerRef.current;
      if (!el) {
        return {
          width: sizeRef.current.width,
          height: sizeRef.current.height,
        };
      }

      const width = el.offsetWidth;
      const height = el.offsetHeight;
      sizeRef.current = { width, height };
      // Drop the content max so height can be driven by the gesture, but keep
      // the viewport cap so the window cannot grow past the screen.
      el.style.maxHeight = "100vh";
      el.style.height = `${height}px`;

      return { width, height };
    }, [userResized]);

    const applyResize = useCallback((clientX: number, clientY: number) => {
      if (!resizeState.current.isResizing) return;
      const { direction, startX, startY, startWidth, startHeight, startPosX, startPosY } =
        resizeState.current;
      const dx = clientX - startX;
      const dy = clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = startPosX;
      let newY = startPosY;

      if (direction.includes("e")) {
        newWidth = Math.min(
          Math.max(startWidth + dx, MIN_WIDTH),
          window.innerWidth - startPosX,
          window.innerWidth,
        );
      }
      if (direction.includes("s")) {
        newHeight = Math.min(
          Math.max(startHeight + dy, MIN_HEIGHT),
          window.innerHeight - startPosY,
          window.innerHeight,
        );
      }
      if (direction.includes("w")) {
        const proposed = startWidth - dx;
        newWidth = Math.min(
          Math.max(Math.min(proposed, startWidth + startPosX), MIN_WIDTH),
          window.innerWidth,
        );
        newX = startPosX + (startWidth - newWidth);
      }
      if (direction.includes("n")) {
        const proposed = startHeight - dy;
        newHeight = Math.min(
          Math.max(Math.min(proposed, startHeight + startPosY), MIN_HEIGHT),
          window.innerHeight,
        );
        newY = startPosY + (startHeight - newHeight);
      }

      sizeRef.current = { width: newWidth, height: newHeight };
      positionRef.current = { x: newX, y: newY };
      if (containerRef.current) {
        containerRef.current.style.width = `${newWidth}px`;
        containerRef.current.style.height = `${newHeight}px`;
        containerRef.current.style.left = `${newX}px`;
        containerRef.current.style.top = `${newY}px`;
      }
    }, []);

    const handleResizeMouseMove = useCallback(
      (e: MouseEvent) => applyResize(e.clientX, e.clientY),
      [applyResize],
    );

    const handleResizeMouseUp = useCallback(() => {
      resizeState.current.isResizing = false;
      setGestureTransition(false);
      setUserResized(true);
      setSize({ ...sizeRef.current });
      setPosition({ ...positionRef.current });
      document.removeEventListener("mousemove", handleResizeMouseMove);
      document.removeEventListener("mouseup", handleResizeMouseUp);
    }, [handleResizeMouseMove, setGestureTransition]);

    const handleResizeMouseDown = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const direction = (e.currentTarget as HTMLElement).dataset.resizeDir as ResizeDirection;
        const { width, height } = prepareResizeGesture();
        resizeState.current = {
          isResizing: true,
          direction,
          startX: e.clientX,
          startY: e.clientY,
          startWidth: width,
          startHeight: height,
          startPosX: positionRef.current.x,
          startPosY: positionRef.current.y,
        };
        setGestureTransition(true);
        document.addEventListener("mousemove", handleResizeMouseMove);
        document.addEventListener("mouseup", handleResizeMouseUp);
      },
      [handleResizeMouseMove, handleResizeMouseUp, prepareResizeGesture, setGestureTransition],
    );

    const handleResizeTouchMove = useCallback(
      (e: TouchEvent) => {
        e.preventDefault();
        applyResize(e.touches[0].clientX, e.touches[0].clientY);
      },
      [applyResize],
    );

    const handleResizeTouchEnd = useCallback(() => {
      resizeState.current.isResizing = false;
      setGestureTransition(false);
      setUserResized(true);
      setSize({ ...sizeRef.current });
      setPosition({ ...positionRef.current });
      document.removeEventListener("touchmove", handleResizeTouchMove);
      document.removeEventListener("touchend", handleResizeTouchEnd);
    }, [handleResizeTouchMove, setGestureTransition]);

    const handleResizeTouchStart = useCallback(
      (e: React.TouchEvent) => {
        // Do not preventDefault here — that cancels the synthesized click when
        // a tap lands on a handle that overlaps a control. touchmove still
        // preventDefaults once the resize gesture is active.
        e.stopPropagation();
        const direction = (e.currentTarget as HTMLElement).dataset.resizeDir as ResizeDirection;
        const touch = e.touches[0];
        const { width, height } = prepareResizeGesture();
        resizeState.current = {
          isResizing: true,
          direction,
          startX: touch.clientX,
          startY: touch.clientY,
          startWidth: width,
          startHeight: height,
          startPosX: positionRef.current.x,
          startPosY: positionRef.current.y,
        };
        setGestureTransition(true);
        document.addEventListener("touchmove", handleResizeTouchMove, { passive: false });
        document.addEventListener("touchend", handleResizeTouchEnd);
      },
      [handleResizeTouchMove, handleResizeTouchEnd, prepareResizeGesture, setGestureTransition],
    );

    useEffect(() => {
      return () => {
        document.removeEventListener("mousemove", handleDragMouseMove);
        document.removeEventListener("mouseup", handleDragMouseUp);
        document.removeEventListener("touchmove", handleDragTouchMove);
        document.removeEventListener("touchend", handleDragTouchEnd);
        document.removeEventListener("mousemove", handleResizeMouseMove);
        document.removeEventListener("mouseup", handleResizeMouseUp);
        document.removeEventListener("touchmove", handleResizeTouchMove);
        document.removeEventListener("touchend", handleResizeTouchEnd);
      };
    }, [handleDragMouseMove, handleDragMouseUp, handleDragTouchMove, handleDragTouchEnd, handleResizeMouseMove, handleResizeMouseUp, handleResizeTouchMove, handleResizeTouchEnd]);

    // ── Derived animation values ──────────────────────────────────────────────
    const isMinimized = phase === "minimized";
    const isTransitioningMinimize =
      phase === "minimizing" || phase === "restoring" || phase === "minimized";

    // Always use `top` so position, height, and content scale all transition together.
    const resolvedTop = isTransitioningMinimize ? minimizedY : position.y;
    const resolvedHeight = isTransitioningMinimize
      ? TITLE_BAR_HEIGHT
      : autoHeight && !userResized
        ? undefined
        : size.height;
    const resolvedMaxHeight =
      autoHeight && !userResized && !isTransitioningMinimize ? size.height : undefined;

    // Whole-window scale: for open/close only
    const windowShrunk = phase === "opening" || phase === "closing";
    const minMaxTransition = `top ${ANIM_MS}ms cubic-bezier(0.2,0,0.2,1), height ${ANIM_MS}ms cubic-bezier(0.2,0,0.2,1)`;
    const openCloseTransition = `transform ${ANIM_MS}ms cubic-bezier(0.2,0,0.2,1), opacity ${ANIM_MS}ms ease`;
    const windowStyle: React.CSSProperties = {
      position: "fixed",
      left: position.x,
      top: resolvedTop,
      width: isMinimized ? Math.min(228, window.innerWidth) : size.width,
      maxWidth: "100vw",
      // Cap content growth and fixed heights to the viewport; autoHeight also
      // keeps its content max when that is smaller than the viewport.
      maxHeight:
        resolvedMaxHeight !== undefined
          ? `min(${resolvedMaxHeight}px, 100vh)`
          : "100vh",
      ...(resolvedHeight !== undefined ? { height: resolvedHeight } : {}),
      zIndex: activeZ,
      transformOrigin: "bottom center",
      // Omitted (not an identity transform) at rest: any `transform` value,
      // even `scaleX(1) scaleY(1)`, makes this element the containing block
      // for `position: fixed` descendants — which breaks a non-portaled
      // Radix popper's viewport-relative sizing (see Select's `disablePortal`),
      // making it size itself for the full viewport and then get silently
      // clipped by this window's `overflow-hidden` instead of fitting inside it.
      ...(windowShrunk ? { transform: "scaleX(0.55) scaleY(0.08)" } : {}),
      opacity: windowShrunk ? 0 : 1,
      transition: `${minMaxTransition}, ${openCloseTransition}`,
    };

    // Content fades out simultaneously with the window sliding down
    const contentHidden = phase === "minimizing" || phase === "minimized" || phase === "restoring";
    const contentStyle: React.CSSProperties = {
      opacity: contentHidden ? 0 : 1,
      transition: phase === "minimized" ? "none" : `opacity ${ANIM_MS}ms ease`,
    };

    const resizeHandleProps = {
      onMouseDown: handleResizeMouseDown,
      onTouchStart: handleResizeTouchStart,
      "aria-hidden": true as const,
    };

    return (
      <div
        data-testid="floating-window"
        style={windowStyle}
        ref={containerRef}
        onMouseDown={raiseWindow}
        onTouchStart={raiseWindow}
        className={cn(
          "flex flex-col overflow-hidden rounded-lg border border-gray-300 bg-gray-800 shadow-2xl",
          isMinimized && "rounded-b-none",
          className,
        )}
      >
        {/* Title bar — keep above content and resize handles for reliable close/minimize taps */}
        <div
          onMouseDown={handleTitleMouseDown}
          onTouchStart={handleTitleTouchStart}
          className="relative z-20 flex shrink-0 cursor-grab items-center justify-between gap-2 bg-gray-700 px-3 py-2 select-none active:cursor-grabbing"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{title}</span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="tertiary"
              svg={isMinimized ? Maximize2 : Minus}
              iconSize="sm"
              className={TITLE_BAR_CONTROL_CLASS}
              onMouseDown={stopTitleControlGesture}
              onTouchStart={stopTitleControlGesture}
              onClick={handleMinimize}
              aria-label={isMinimized ? "Restore window" : "Minimize window"}
            />
            <Button
              variant="tertiary"
              svg={X}
              iconSize="sm"
              className={TITLE_BAR_CONTROL_CLASS}
              onMouseDown={stopTitleControlGesture}
              onTouchStart={stopTitleControlGesture}
              onClick={handleClose}
              aria-label="Close window"
            />
          </div>
        </div>

        {/* Content — animates in/out independently for minimize/restore */}
        <div style={contentStyle} className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", contentHidden && "pointer-events-none")}>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-3 scrollbar-variable",
              contentClassName,
            )}
          >
            {children}
          </div>
        </div>

        {/* Resize handles — sides and bottom only (never on the title bar) */}
        {!isMinimized && (
          <>
            <div data-testid="resize-handle-w" data-resize-dir="w" className={cn(SIDE_EDGE_RESIZE_CLASS, "left-0")} {...resizeHandleProps} />
            <div data-testid="resize-handle-e" data-resize-dir="e" className={cn(SIDE_EDGE_RESIZE_CLASS, "right-0")} {...resizeHandleProps} />
            <div data-testid="resize-handle-s" data-resize-dir="s" className={BOTTOM_EDGE_RESIZE_CLASS} {...resizeHandleProps} />
            <div
              data-testid="resize-handle-sw"
              data-resize-dir="sw"
              className={cn(BOTTOM_CORNER_RESIZE_CLASS, "left-0 cursor-nesw-resize")}
              {...resizeHandleProps}
            />
            <div
              data-testid="resize-handle-se"
              data-resize-dir="se"
              className={cn(BOTTOM_CORNER_RESIZE_CLASS, "right-0 cursor-nwse-resize")}
              {...resizeHandleProps}
            />
          </>
        )}
      </div>
    );
  },
);

export default FloatingWindow;
