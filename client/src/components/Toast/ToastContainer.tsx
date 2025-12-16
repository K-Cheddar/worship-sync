import React from "react";
import Toast, { ToastPosition, ToastVariant } from "./Toast";

export type ToastData = {
  id: string;
  message?: string;
  children?: React.ReactNode | ((toastId: string) => React.ReactNode);
  variant?: ToastVariant;
  position?: ToastPosition;
  persist?: boolean;
  duration?: number;
};

type ToastContainerProps = {
  toasts: ToastData[];
  onRemove: (id: string) => void;
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
    <div className="fixed inset-0 pointer-events-none z-[9999]">
      {Object.entries(toastsByPosition).map(([position, positionToasts]) => (
        <div key={position} className={`toast-group toast-group-${position}`}>
          {positionToasts.map((toast) => {
            const children =
              typeof toast.children === "function"
                ? toast.children(toast.id)
                : toast.children;

            return (
              <Toast
                key={toast.id}
                {...toast}
                children={children}
                onClose={() => onRemove(toast.id)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
