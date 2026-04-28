import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Maximize2, X } from "lucide-react";
import Button from "../Button/Button";
import { cn } from "@/utils/cnHelper";
import { useFloatingWindowBringToFront } from "./FloatingWindowZIndexContext";

const TITLE_BAR_HEIGHT = 40;
const MIN_WIDTH = 200;
const MIN_HEIGHT = TITLE_BAR_HEIGHT + 60;

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

const FloatingWindow = ({
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
}: FloatingWindowProps) => {
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

  const [isMinimized, setIsMinimized] = useState(initiallyMinimized);
  const isMinimizedRef = useRef(isMinimized);
  useEffect(() => {
    isMinimizedRef.current = isMinimized;
  }, [isMinimized]);

  // --- Drag ---

  const dragState = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({ isDragging: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  const clampPosition = useCallback((x: number, y: number) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = isMinimizedRef.current || autoHeightRef.current
      ? TITLE_BAR_HEIGHT
      : sizeRef.current.height;
    return {
      x: Math.min(Math.max(x, 0), Math.max(vw - sizeRef.current.width, 0)),
      y: Math.min(Math.max(y, 0), Math.max(vh - h, 0)),
    };
  }, []);

  const handleDragMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.current.isDragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPosition(clampPosition(dragState.current.originX + dx, dragState.current.originY + dy));
  }, [clampPosition]);

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
    [position, handleDragMouseMove, handleDragMouseUp]
  );

  // --- Resize ---

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
      width: Math.min(Math.max(resizeState.current.startWidth + dx, MIN_WIDTH), window.innerWidth),
      height: Math.min(Math.max(resizeState.current.startHeight + dy, MIN_HEIGHT), window.innerHeight),
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
    [handleResizeMouseMove, handleResizeMouseUp, userResized]
  );

  // --- Cleanup ---

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleDragMouseMove);
      document.removeEventListener("mouseup", handleDragMouseUp);
      document.removeEventListener("mousemove", handleResizeMouseMove);
      document.removeEventListener("mouseup", handleResizeMouseUp);
    };
  }, [handleDragMouseMove, handleDragMouseUp, handleResizeMouseMove, handleResizeMouseUp]);

  // --- Styles ---

  const minimizedStyle: React.CSSProperties = {
    position: "fixed",
    left: position.x,
    bottom: 0,
    width: size.width,
    zIndex: activeZ,
  };

  const useMaxHeight = autoHeight && !userResized;
  const normalStyle: React.CSSProperties = {
    position: "fixed",
    left: position.x,
    top: position.y,
    width: size.width,
    ...(useMaxHeight ? { maxHeight: size.height } : { height: size.height }),
    zIndex: activeZ,
  };

  return (
    <div
      style={isMinimized ? minimizedStyle : normalStyle}
      ref={containerRef}
      onMouseDown={() => setActiveZ(bringToFront())}
      className={cn(
        "flex flex-col overflow-hidden rounded-lg shadow-2xl border border-white/10 bg-gray-800",
        isMinimized && "rounded-b-none",
        className
      )}
    >
      <div
        onMouseDown={handleTitleMouseDown}
        className="flex shrink-0 cursor-grab items-center justify-between gap-2 bg-gray-700 px-3 py-2 select-none active:cursor-grabbing"
      >
        <span className="truncate text-sm font-semibold text-white">
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="tertiary"
            svg={isMinimized ? Maximize2 : Minus}
            iconSize="sm"
            onClick={() => setIsMinimized((v) => !v)}
            aria-label={isMinimized ? "Restore window" : "Minimize window"}
          />
          <Button
            variant="tertiary"
            svg={X}
            iconSize="sm"
            onClick={onClose}
            aria-label="Close window"
          />
        </div>
      </div>

      {!isMinimized && (
        <>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-3 scrollbar-variable",
              contentClassName
            )}
          >
            {children}
          </div>
          <div
            onMouseDown={handleResizeMouseDown}
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
              <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
};

export default FloatingWindow;
