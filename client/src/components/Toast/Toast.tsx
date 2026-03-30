import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, CircleAlert, CheckCircle2, Info } from "lucide-react";
import cn from "classnames";
import Button from "../Button/Button";
import Icon from "../Icon/Icon";

export type ToastPosition =
  | "top-left"
  | "top-right"
  | "top-center"
  | "bottom-left"
  | "bottom-right"
  | "bottom-center";

export type ToastVariant = "info" | "success" | "error" | "neutral";

export type ToastProps = {
  id: string;
  message?: string;
  children?: React.ReactNode;
  variant?: ToastVariant;
  position?: ToastPosition;
  persist?: boolean;
  duration?: number;
  showCloseButton?: boolean;
  onClose: () => void;
};

const Toast: React.FC<ToastProps> = ({
  id,
  message,
  children,
  variant = "info",
  position = "top-center",
  persist = false,
  duration = 7000,
  showCloseButton = true,
  onClose,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissStartedAtRef = useRef<number | null>(null);
  const remainingDurationRef = useRef(duration);

  const handleClose = useCallback(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 200); // Match animation duration
  }, [onClose]);

  const startDismissTimer = useCallback(
    (delay: number) => {
      if (persist || isExiting) return;
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
      dismissStartedAtRef.current = Date.now();
      dismissTimeoutRef.current = setTimeout(() => {
        handleClose();
      }, delay);
    },
    [handleClose, isExiting, persist]
  );

  useEffect(() => {
    // Trigger enter animation
    setIsVisible(true);
  }, []);

  useEffect(() => {
    remainingDurationRef.current = duration;
  }, [duration, id]);

  useEffect(() => {
    if (persist || isExiting) {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
        dismissTimeoutRef.current = null;
      }
      return;
    }

    if (isPaused) {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
        dismissTimeoutRef.current = null;
      }
      if (dismissStartedAtRef.current !== null) {
        const elapsed = Date.now() - dismissStartedAtRef.current;
        remainingDurationRef.current = Math.max(
          0,
          remainingDurationRef.current - elapsed
        );
      }
      dismissStartedAtRef.current = null;
      return;
    }

    startDismissTimer(remainingDurationRef.current);

    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
        dismissTimeoutRef.current = null;
      }
    };
  }, [isPaused, isExiting, persist, startDismissTimer]);

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  const variantConfig = {
    info: {
      icon: Info,
      iconColor: "#3b82f6", // blue-500
      borderColor: "#3b82f6",
      textColor: "text-gray-900",
    },
    success: {
      icon: CheckCircle2,
      iconColor: "#10b981", // green-500
      borderColor: "#10b981",
      textColor: "text-gray-900",
    },
    error: {
      icon: CircleAlert,
      iconColor: "#ef4444", // red-500
      borderColor: "#ef4444",
      textColor: "text-gray-900",
    },
    neutral: {
      icon: Info,
      iconColor: "#6b7280", // gray-500
      borderColor: "#6b7280",
      textColor: "text-gray-900",
    },
  };

  const config = variantConfig[variant];

  const positionStyles = {
    "top-left": "top-4 left-4",
    "top-right": "top-4 right-4",
    "top-center": "top-4 left-1/2 -translate-x-1/2",
    "bottom-left": "bottom-4 left-4",
    "bottom-right": "bottom-4 right-4",
    "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
  };

  return (
    <div
      className={cn(
        "fixed z-9999 min-w-[300px] max-w-[50vw] px-4 py-3 rounded-lg border-2 shadow-md pointer-events-auto bg-white",
        config.textColor,
        positionStyles[position],
        isVisible && !isExiting && "opacity-100 translate-y-0",
        !isVisible && !isExiting && "opacity-0 -translate-y-2",
        isExiting && "opacity-0 -translate-y-2",
        "transition duration-200 ease-in-out"
      )}
      style={{
        borderColor: config.borderColor,
      }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={(e) => {
        const nextFocused = e.relatedTarget;
        if (nextFocused && e.currentTarget.contains(nextFocused as Node)) {
          return;
        }
        setIsPaused(false);
      }}
    >
      <div className="flex items-center gap-3">
        {variant !== "neutral" && (
          <Icon
            svg={config.icon}
            size="md"
            color={config.iconColor}
            className="shrink-0"
          />
        )}
        <div className="flex-1 w-max">
          {message && (
            <p className="text-sm text-center font-medium">{message}</p>
          )}
          {children && <div>{children}</div>}
        </div>
        {showCloseButton && (
          <Button
            onClick={handleClose}
            svg={X}
            variant="none"
            padding="p-1"
            className="w-6"
            aria-label="Close toast"
          />
        )}
      </div>
    </div>
  );
};

export default Toast;
