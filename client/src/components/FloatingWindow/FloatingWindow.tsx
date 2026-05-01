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
  title: string;
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

    const handleDragMouseMove = useCallback(
      (e: MouseEvent) => {
        if (!dragState.current.isDragging) return;
        const dx = e.clientX - dragState.current.startX;
        const dy = e.clientY - dragState.current.startY;
        setPosition(
          clampPosition(dragState.current.originX + dx, dragState.current.originY + dy),
        );
      },
      [clampPosition],
    );

    const handleDragMouseUp = useCallback(() => {
      dragState.current.isDragging = false;
      document.removeEventListener("mousemove", handleDragMouseMove);
      document.removeEventListener("mouseup", handleDragMouseUp);
    }, [handleDragMouseMove]);

    const handleTitleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        dragState.current = {
          isDragging: true,
          startX: e.clientX,
          startY: e.clientY,
          originX: position.x,
          originY: position.y,
        };
        document.addEventListener("mousemove", handleDragMouseMove);
        document.addEventListener("mouseup", handleDragMouseUp);
      },
      [position, handleDragMouseMove, handleDragMouseUp],
    );

    const handleDragTouchMove = useCallback(
      (e: TouchEvent) => {
        if (!dragState.current.isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        const dx = touch.clientX - dragState.current.startX;
        const dy = touch.clientY - dragState.current.startY;
        setPosition(
          clampPosition(dragState.current.originX + dx, dragState.current.originY + dy),
        );
      },
      [clampPosition],
    );

    const handleDragTouchEnd = useCallback(() => {
      dragState.current.isDragging = false;
      document.removeEventListener("touchmove", handleDragTouchMove);
      document.removeEventListener("touchend", handleDragTouchEnd);
    }, [handleDragTouchMove]);

    const handleTitleTouchStart = useCallback(
      (e: React.TouchEvent) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const touch = e.touches[0];
        dragState.current = {
          isDragging: true,
          startX: touch.clientX,
          startY: touch.clientY,
          originX: position.x,
          originY: position.y,
        };
        document.addEventListener("touchmove", handleDragTouchMove, { passive: false });
        document.addEventListener("touchend", handleDragTouchEnd);
      },
      [position, handleDragTouchMove, handleDragTouchEnd],
    );

    // ── Resize ───────────────────────────────────────────────────────────────
    const resizeState = useRef<{
      isResizing: boolean;
      startX: number;
      startY: number;
      startWidth: number;
      startHeight: number;
    }>({ isResizing: false, startX: 0, startY: 0, startWidth: 0, startHeight: 0 });

    const handleResizeMouseMove = useCallback((e: MouseEvent) => {
      if (!resizeState.current.isResizing) return;
      const dx = e.clientX - resizeState.current.startX;
      const dy = e.clientY - resizeState.current.startY;
      setUserResized(true);
      setSize({
        width: Math.min(
          Math.max(resizeState.current.startWidth + dx, MIN_WIDTH),
          window.innerWidth,
        ),
        height: Math.min(
          Math.max(resizeState.current.startHeight + dy, MIN_HEIGHT),
          window.innerHeight,
        ),
      });
    }, []);

    const handleResizeMouseUp = useCallback(() => {
      resizeState.current.isResizing = false;
      document.removeEventListener("mousemove", handleResizeMouseMove);
      document.removeEventListener("mouseup", handleResizeMouseUp);
    }, [handleResizeMouseMove]);

    const handleResizeMouseDown = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const actualHeight =
          !userResized && containerRef.current
            ? containerRef.current.offsetHeight
            : sizeRef.current.height;
        resizeState.current = {
          isResizing: true,
          startX: e.clientX,
          startY: e.clientY,
          startWidth: sizeRef.current.width,
          startHeight: actualHeight,
        };
        document.addEventListener("mousemove", handleResizeMouseMove);
        document.addEventListener("mouseup", handleResizeMouseUp);
      },
      [handleResizeMouseMove, handleResizeMouseUp, userResized],
    );

    const handleResizeTouchMove = useCallback((e: TouchEvent) => {
      if (!resizeState.current.isResizing) return;
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - resizeState.current.startX;
      const dy = touch.clientY - resizeState.current.startY;
      setUserResized(true);
      setSize({
        width: Math.min(
          Math.max(resizeState.current.startWidth + dx, MIN_WIDTH),
          window.innerWidth,
        ),
        height: Math.min(
          Math.max(resizeState.current.startHeight + dy, MIN_HEIGHT),
          window.innerHeight,
        ),
      });
    }, []);

    const handleResizeTouchEnd = useCallback(() => {
      resizeState.current.isResizing = false;
      document.removeEventListener("touchmove", handleResizeTouchMove);
      document.removeEventListener("touchend", handleResizeTouchEnd);
    }, [handleResizeTouchMove]);

    const handleResizeTouchStart = useCallback(
      (e: React.TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const touch = e.touches[0];
        const actualHeight =
          !userResized && containerRef.current
            ? containerRef.current.offsetHeight
            : sizeRef.current.height;
        resizeState.current = {
          isResizing: true,
          startX: touch.clientX,
          startY: touch.clientY,
          startWidth: sizeRef.current.width,
          startHeight: actualHeight,
        };
        document.addEventListener("touchmove", handleResizeTouchMove, { passive: false });
        document.addEventListener("touchend", handleResizeTouchEnd);
      },
      [handleResizeTouchMove, handleResizeTouchEnd, userResized],
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
    const minimizedTop = window.innerHeight - TITLE_BAR_HEIGHT;
    const resolvedTop = isTransitioningMinimize ? minimizedTop : position.y;
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
      width: size.width,
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
          className="flex shrink-0 cursor-grab items-center justify-between gap-2 bg-gray-700 px-3 py-2 select-none active:cursor-grabbing"
        >
          <span className="truncate text-sm font-semibold text-white">{title}</span>
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
          <div
            onMouseDown={handleResizeMouseDown}
            onTouchStart={handleResizeTouchStart}
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
            aria-hidden
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className="absolute bottom-1 right-1 text-zinc-500"
              fill="currentColor"
            >
              <path
                d="M9 1L1 9M9 5L5 9M9 9L9 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </div>
    );
  },
);

export default FloatingWindow;
