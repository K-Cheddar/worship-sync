import React from "react";
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
  return (
    <div
      className={cn(
        "toast-group fixed flex flex-col gap-2 max-w-[75vw]",
        `toast-group-${position}`,
        positionGroupClassName[position]
      )}
      data-testid={`toast-group-${position}`}
    >
      {toasts.map((toast) => {
        const children =
          typeof toast.children === "function"
            ? toast.children(toast.id)
            : toast.children;

        return (
          <div key={toast.id}>
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
