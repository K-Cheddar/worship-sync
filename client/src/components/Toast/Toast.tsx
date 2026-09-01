import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  CircleAlert,
  CheckCircle2,
  Info,
  MessageCircle,
  TriangleAlert,
} from "lucide-react";
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

export type ToastVariant =
  | "info"
  | "success"
  | "error"
  | "neutral"
  | "warning"
  | "chat";

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
  const entersFromTop = position.startsWith("top");

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
      iconColor: "#60a5fa", // blue-400
      borderColor: "#60a5fa",
      textColor: "text-zinc-100",
    },
    success: {
      icon: CheckCircle2,
      iconColor: "#34d399", // emerald-400
      borderColor: "#34d399",
      textColor: "text-zinc-100",
    },
    error: {
      icon: CircleAlert,
      iconColor: "#f87171", // red-400
      borderColor: "#f87171",
      textColor: "text-zinc-100",
    },
    neutral: {
      icon: Info,
      iconColor: "#a1a1aa", // zinc-400
      borderColor: "#a1a1aa",
      textColor: "text-zinc-100",
    },
    // For an action that succeeded but left something for the operator to
    // notice — "sent, but two people have no email". `error` would overstate it
    // and `success` would bury the part they need to act on.
    warning: {
      icon: TriangleAlert,
      iconColor: "#fbbf24", // amber-400
      borderColor: "#fbbf24",
      textColor: "text-zinc-100",
    },
    chat: {
      icon: MessageCircle,
      iconColor: "#22d3ee", // cyan-400
      borderColor: "#22d3ee",
      textColor: "text-zinc-100",
    },
  };

  // Fall back rather than index into nothing: an unrecognised variant used to
  // crash the whole page on `config.textColor`, which is a severe outcome for
  // what is only a styling choice. A plain toast is always better than none.
  const config = variantConfig[variant] || variantConfig.neutral;
  const hiddenOffset = entersFromTop
    ? "-translate-y-2"
    : "translate-y-2";

  const showProgress = !persist && duration > 0;

  return (
    <div
      role="status"
      className={cn(
        "relative z-9999 px-4 py-3 rounded-lg border-2 shadow-lg shadow-black/30 pointer-events-auto bg-zinc-900 overflow-hidden",
        variant === "chat"
          ? "min-w-0 w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]"
          : "min-w-[min(300px,calc(100vw-2rem))] max-w-[75vw]",
        config.textColor,
        isVisible && !isExiting && "opacity-100 translate-y-0",
        !isVisible && !isExiting && `opacity-0 ${hiddenOffset}`,
        isExiting && `opacity-0 ${hiddenOffset}`,
        "transition-[opacity,transform] duration-200 ease-in-out"
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
      <div
        className={cn(
          "flex items-start gap-3",
          variant === "chat" && "relative block",
        )}
      >
        {variant !== "neutral" && variant !== "chat" && (
          <Icon
            svg={config.icon}
            size="md"
            color={config.iconColor}
            className={cn(
              "mt-0.5 shrink-0",
            )}
          />
        )}
        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden",
            variant === "chat" && "w-full",
          )}
        >
          {message && (
            <p className="text-sm text-center font-medium wrap-break-word">
              {message}
            </p>
          )}
          {children && <div className="min-w-0">{children}</div>}
        </div>
        {showCloseButton && (
          <Button
            onClick={handleClose}
            svg={X}
            variant="none"
            padding="p-1"
            className={cn(
              "w-6",
              variant === "chat" && "absolute right-0 top-0",
            )}
            color="#d4d4d8"
            aria-label="Close toast"
          />
        )}
      </div>
      {showProgress && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
        >
          <div
            data-testid="toast-progress"
            className="h-full w-full origin-left opacity-70"
            style={{
              backgroundColor: config.borderColor,
              animation: `toast-dismiss-progress ${duration}ms linear forwards`,
              animationPlayState: isPaused || isExiting ? "paused" : "running",
            }}
          />
        </div>
      )}
    </div>
  );
};

export default Toast;
