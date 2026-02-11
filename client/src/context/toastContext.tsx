import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import ToastContainer, { ToastData } from "../components/Toast/ToastContainer";
import { ToastPosition, ToastVariant } from "../components/Toast/Toast";

type ToastContextType = {
  showToast: (
    messageOrData: string | Omit<ToastData, "id">,
    variant?: ToastVariant,
    position?: ToastPosition
  ) => string;
  removeToast: (id: string) => void;
};

export const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (
      messageOrData: string | Omit<ToastData, "id">,
      variant?: ToastVariant,
      position?: ToastPosition
    ) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      let toastData: ToastData;

      if (typeof messageOrData === "string") {
        toastData = {
          id,
          message: messageOrData,
          variant,
          position,
        };
      } else {
        toastData = {
          id,
          ...messageOrData,
          variant: messageOrData.variant,
          position: messageOrData.position,
        };
      }

      setToasts((prev) => [...prev, toastData]);
      return toastData.id;
    },
    []
  );

  const toastPortal = useMemo(
    () =>
      createPortal(
        <ToastContainer toasts={toasts} onRemove={removeToast} />,
        document.body
      ),
    [toasts, removeToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, removeToast }}>
      {children}
      {toastPortal}
    </ToastContext.Provider>
  );
};
