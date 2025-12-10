import React from "react";
import Toast, { ToastPosition, ToastVariant } from "./Toast";
import "./ToastContainer.scss";

export type ToastData = {
  id: string;
  message?: string;
  children?: React.ReactNode;
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
      const position = toast.position || "top-right";
      if (!acc[position]) {
        acc[position] = [];
      }
      acc[position].push(toast);
      return acc;
    },
    {} as Record<ToastPosition, ToastData[]>
  );

  return (
    <div className="toast-container">
      {Object.entries(toastsByPosition).map(([position, positionToasts]) => (
        <div key={position} className={`toast-group toast-group-${position}`}>
          {positionToasts.map((toast) => (
            <Toast
              key={toast.id}
              {...toast}
              onClose={() => onRemove(toast.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
