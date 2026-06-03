import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Minus, Maximize2, X } from "lucide-react";
import Button from "../Button/Button";
import { cn } from "@/utils/cnHelper";
import { useFloatingWindowBringToFront } from "./FloatingWindowZIndexContext";

const TITLE_BAR_HEIGHT = 40;
const MIN_WIDTH = 200;
const MIN_HEIGHT = TITLE_BAR_HEIGHT + 60;
const ANIM_MS = 180;

export interface FloatingWindowHandle {
  restore: () => void;
}

interface FloatingWindowProps {
  title: React.ReactNode;
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
  zIndex?: number;
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
      children,
      onClose,
      defaultPosition,
      defaultWidth = 400,
      defaultHeight = 300,
      autoHeight = false,
      contentClassName,
      className,
      initiallyMinimized = false,
      zIndex = 60,
    },
    ref,
  ) {
    const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });
    const [userResized, setUserResized] = useState(false);
    const sizeRef = useRef(size);
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      sizeRef.current = size;
    }, [size]);

    const [position, setPosition] = useState(() => {
      const p = defaultPosition ?? {
        x: (window.innerWidth - defaultWidth) / 2,
        y: (window.innerHeight - defaultHeight) / 2,
      };
      return {
        x: Math.min(Math.max(p.x, 0), Math.max(window.innerWidth - defaultWidth, 0)),
        y: autoHeight
          ? Math.max(p.y, 0)
          : Math.min(Math.max(p.y, 0), Math.max(window.innerHeight - defaultHeight, 0)),
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
    const [activeZ, setActiveZ] = useState(zIndex);

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

    const handleClose = useCallback(() => {
      clearAnimTimer();
      setPhase("closing");
      animTimerRef.current = setTimeout(() => onClose(), ANIM_MS);
    }, [onClose]);

    useEffect(() => () => clearAnimTimer(), []);

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
        if ((e.target as HTMLElement).closest("button")) return;
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
        if ((e.target as HTMLElement).closest("button")) return;
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
        );
      }
      if (direction.includes("s")) {
        newHeight = Math.min(
          Math.max(startHeight + dy, MIN_HEIGHT),
          window.innerHeight - startPosY,
        );
      }
      if (direction.includes("w")) {
        const proposed = startWidth - dx;
        newWidth = Math.max(Math.min(proposed, startWidth + startPosX), MIN_WIDTH);
        newX = startPosX + (startWidth - newWidth);
      }
      if (direction.includes("n")) {
        const proposed = startHeight - dy;
        newHeight = Math.max(Math.min(proposed, startHeight + startPosY), MIN_HEIGHT);
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
        const actualHeight =
          !userResized && containerRef.current
            ? containerRef.current.offsetHeight
            : sizeRef.current.height;
        resizeState.current = {
          isResizing: true,
          direction,
          startX: e.clientX,
          startY: e.clientY,
          startWidth: sizeRef.current.width,
          startHeight: actualHeight,
          startPosX: positionRef.current.x,
          startPosY: positionRef.current.y,
        };
        setGestureTransition(true);
        document.addEventListener("mousemove", handleResizeMouseMove);
        document.addEventListener("mouseup", handleResizeMouseUp);
      },
      [handleResizeMouseMove, handleResizeMouseUp, userResized, setGestureTransition],
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
        e.preventDefault();
        e.stopPropagation();
        const direction = (e.currentTarget as HTMLElement).dataset.resizeDir as ResizeDirection;
        const touch = e.touches[0];
        const actualHeight =
          !userResized && containerRef.current
            ? containerRef.current.offsetHeight
            : sizeRef.current.height;
        resizeState.current = {
          isResizing: true,
          direction,
          startX: touch.clientX,
          startY: touch.clientY,
          startWidth: sizeRef.current.width,
          startHeight: actualHeight,
          startPosX: positionRef.current.x,
          startPosY: positionRef.current.y,
        };
        setGestureTransition(true);
        document.addEventListener("touchmove", handleResizeTouchMove, { passive: false });
        document.addEventListener("touchend", handleResizeTouchEnd);
      },
      [handleResizeTouchMove, handleResizeTouchEnd, userResized, setGestureTransition],
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
      width: isMinimized ? 228 : size.width,
      ...(resolvedHeight !== undefined ? { height: resolvedHeight } : {}),
      ...(resolvedMaxHeight !== undefined ? { maxHeight: resolvedMaxHeight } : {}),
      zIndex: activeZ,
      transformOrigin: "bottom center",
      transform: windowShrunk ? "scaleX(0.55) scaleY(0.08)" : "scaleX(1) scaleY(1)",
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
        style={windowStyle}
        ref={containerRef}
        onMouseDown={() => setActiveZ(bringToFront())}
        onTouchStart={() => setActiveZ(bringToFront())}
        className={cn(
          "flex flex-col overflow-hidden rounded-lg border border-gray-300 bg-gray-800 shadow-2xl",
          isMinimized && "rounded-b-none",
          className,
        )}
      >
        {/* Title bar */}
        <div
          onMouseDown={handleTitleMouseDown}
          onTouchStart={handleTitleTouchStart}
          className="relative z-10 flex shrink-0 cursor-grab items-center justify-between gap-2 bg-gray-700 px-3 py-2 select-none active:cursor-grabbing"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{title}</span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="tertiary"
              svg={isMinimized ? Maximize2 : Minus}
              iconSize="sm"
              onClick={handleMinimize}
              aria-label={isMinimized ? "Restore window" : "Minimize window"}
            />
            <Button
              variant="tertiary"
              svg={X}
              iconSize="sm"
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

        {/* Resize handles — edges and corners */}
        {!isMinimized && (
          <>
            {/* Edges */}
            <div data-resize-dir="n" className="absolute top-0 left-12 right-12 h-1 cursor-ns-resize pointer-coarse:h-6" {...resizeHandleProps} />
            <div data-resize-dir="s" className="absolute bottom-0 left-12 right-12 h-1 cursor-ns-resize pointer-coarse:h-6" {...resizeHandleProps} />
            <div data-resize-dir="w" className="absolute left-0 top-12 bottom-12 w-1 cursor-ew-resize pointer-coarse:w-6" {...resizeHandleProps} />
            <div data-resize-dir="e" className="absolute right-0 top-12 bottom-12 w-1 cursor-ew-resize pointer-coarse:w-6" {...resizeHandleProps} />
            {/* Corners */}
            <div data-resize-dir="nw" className="absolute top-0 left-0 h-3 w-3 cursor-nwse-resize pointer-coarse:h-12 pointer-coarse:w-12" {...resizeHandleProps} />
            <div data-resize-dir="ne" className="absolute top-0 right-0 h-3 w-3 cursor-nesw-resize pointer-coarse:h-12 pointer-coarse:w-12" {...resizeHandleProps} />
            <div data-resize-dir="sw" className="absolute bottom-0 left-0 h-3 w-3 cursor-nesw-resize pointer-coarse:h-12 pointer-coarse:w-12" {...resizeHandleProps} />
            <div data-resize-dir="se" className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize pointer-coarse:h-12 pointer-coarse:w-12" {...resizeHandleProps} />
          </>
        )}
      </div>
    );
  },
);

export default FloatingWindow;
