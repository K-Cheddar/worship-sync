import React, { useState } from "react";
import cn from "classnames";
import Toast, { ToastPosition, ToastVariant } from "./Toast";

export type ToastData = {
  id: string;
  message?: string;
  children?: React.ReactNode | ((toastId: string) => React.ReactNode);
  variant?: ToastVariant;
  position?: ToastPosition;
  persist?: boolean;
  duration?: number;
  showCloseButton?: boolean;
};

type ToastContainerProps = {
  toasts: ToastData[];
  onRemove: (id: string) => void;
};

const positionGroupClassName: Record<ToastPosition, string> = {
  "top-left": "top-4 left-4 items-start",
  "top-right": "top-4 right-4 items-end",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-right": "bottom-4 right-4 items-end",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
};

// Background toasts collapse to a thin peeking sliver so a full stack
// doesn't crowd the screen; hovering or focusing the stack expands every
// toast back into a fully readable column.
const COLLAPSED_PEEK_HEIGHT = "10px";
const EXPANDED_MAX_HEIGHT = "240px";

type ToastStackProps = {
  position: ToastPosition;
  // Already ordered newest-closest-to-the-viewport-edge.
  toasts: ToastData[];
  onRemove: (id: string) => void;
};

const ToastStack: React.FC<ToastStackProps> = ({
  position,
  toasts,
  onRemove,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isTop = position.startsWith("top");
  const canCollapse = toasts.length > 1;

  return (
    <div
      className={cn(
        "toast-group fixed flex flex-col gap-2 max-w-[75vw]",
        `toast-group-${position}`,
        positionGroupClassName[position]
      )}
      data-testid={`toast-group-${position}`}
      onMouseEnter={() => canCollapse && setIsExpanded(true)}
      onMouseLeave={() => canCollapse && setIsExpanded(false)}
      onFocusCapture={() => canCollapse && setIsExpanded(true)}
      onBlurCapture={(e) => {
        if (!canCollapse) return;
        const nextFocused = e.relatedTarget;
        if (nextFocused && e.currentTarget.contains(nextFocused as Node)) {
          return;
        }
        setIsExpanded(false);
      }}
    >
      {toasts.map((toast, index) => {
        // Depth 0 is the frontmost (newest) toast, always fully visible.
        const depth = isTop ? index : toasts.length - 1 - index;
        const isCollapsible = canCollapse && depth > 0;
        const isHiddenBackground = isCollapsible && !isExpanded;
        const children =
          typeof toast.children === "function"
            ? toast.children(toast.id)
            : toast.children;

        return (
          <div
            key={toast.id}
            aria-hidden={isHiddenBackground || undefined}
            // Fully removes the clipped sliver from focus/AT while collapsed.
            inert={isHiddenBackground || undefined}
            className="transition-[max-height,opacity,transform] duration-200 ease-in-out"
            style={{
              overflow: isCollapsible ? "hidden" : undefined,
              maxHeight: isCollapsible
                ? isExpanded
                  ? EXPANDED_MAX_HEIGHT
                  : COLLAPSED_PEEK_HEIGHT
                : undefined,
              opacity: isHiddenBackground
                ? Math.max(0.35, 1 - depth * 0.25)
                : 1,
              transform: isHiddenBackground
                ? `scale(${Math.max(0.9, 1 - depth * 0.04)})`
                : "scale(1)",
              transformOrigin: isTop ? "top center" : "bottom center",
              pointerEvents: isHiddenBackground ? "none" : "auto",
              zIndex: toasts.length - depth,
            }}
          >
            <Toast
              {...toast}
              children={children}
              onClose={() => onRemove(toast.id)}
            />
          </div>
        );
      })}
    </div>
  );
};

const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onRemove,
}) => {
  // Group toasts by position
  const toastsByPosition = toasts.reduce(
    (acc, toast) => {
      const position = toast.position || "top-center";
      if (!acc[position]) {
        acc[position] = [];
      }
      acc[position].push(toast);
      return acc;
    },
    {} as Record<ToastPosition, ToastData[]>
  );

  return (
    <div className="absolute inset-0 pointer-events-none z-9999">
      {Object.entries(toastsByPosition).map(([position, positionToasts]) => {
        const toastPosition = position as ToastPosition;
        const isTop = toastPosition.startsWith("top");
        // Newest closest to the viewport edge; older toasts stay fully readable.
        const orderedToasts = isTop
          ? [...positionToasts].reverse()
          : positionToasts;

        return (
          <ToastStack
            key={position}
            position={toastPosition}
            toasts={orderedToasts}
            onRemove={onRemove}
          />
        );
      })}
    </div>
  );
};

export default ToastContainer;
