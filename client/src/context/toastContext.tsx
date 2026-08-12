import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import ToastContainer, { ToastData } from "../components/Toast/ToastContainer";
import { ToastPosition, ToastVariant } from "../components/Toast/Toast";
import { appendToast } from "../components/Toast/toastQueue";
import { registerAuthErrorHandler } from "../api/authErrorBus";
import { showAuthErrorToast } from "../utils/apiErrorToast";

type ToastContextType = {
  showToast: (
    messageOrData: string | Omit<ToastData, "id">,
    variant?: ToastVariant,
    position?: ToastPosition
  ) => string;
  updateToast: (id: string, patch: Partial<Omit<ToastData, "id">>) => void;
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

  const updateToast = useCallback(
    (id: string, patch: Partial<Omit<ToastData, "id">>) => {
      setToasts((prev) =>
        prev.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)),
      );
    },
    [],
  );

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

      setToasts((prev) => appendToast(prev, toastData));
      return toastData.id;
    },
    []
  );

  // Any action that 401s (via the central API layer) shows the refresh toast,
  // even if the call site doesn't handle the error itself.
  useEffect(() => {
    return registerAuthErrorHandler(() => showAuthErrorToast(showToast));
  }, [showToast]);

  const toastPortal = useMemo(
    () =>
      createPortal(
        <ToastContainer toasts={toasts} onRemove={removeToast} />,
        document.body
      ),
    [toasts, removeToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, updateToast, removeToast }}>
      {children}
      {toastPortal}
    </ToastContext.Provider>
  );
};
