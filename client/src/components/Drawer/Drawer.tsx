import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import cn from "classnames";
import Button from "../Button/Button";
import { X } from "lucide-react";

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  position?: "left" | "right" | "top" | "bottom";
  size?: "sm" | "md" | "lg" | "xl" | "full";
  showCloseButton?: boolean;
  contentPadding?: string;
  showBackdrop?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  className?: string;
  contentClassName?: string;
}

const sizeClasses = {
  sm: "w-[20%]",
  md: "w-[30%]",
  lg: "w-[40%]",
  xl: "w-[50%]",
  full: "w-full",
};

const heightSizeClasses = {
  sm: "h-[20%]",
  md: "h-[35%]",
  lg: "h-[50%]",
  xl: "h-[75%]",
  full: "h-full",
};

const positionClasses = {
  left: "left-0 top-0 h-full",
  right: "right-0 top-0 h-full",
  top: "top-0 left-0 w-full",
  bottom: "bottom-0 left-0 w-full",
};

const getTransform = (position: string, isVisible: boolean) => {
  if (isVisible) return "translate3d(0, 0, 0)";
  const transforms: Record<string, string> = {
    left: "translate3d(-100%, 0, 0)",
    right: "translate3d(100%, 0, 0)",
    top: "translate3d(0, -100%, 0)",
    bottom: "translate3d(0, 100%, 0)",
  };
  return transforms[position] || transforms.right;
};

const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
  position = "right",
  size = "md",
  showCloseButton = true,
  contentPadding = "p-4",
  showBackdrop = false,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className,
  contentClassName = "overflow-auto flex-1 min-h-0",
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);

  // Handle Escape key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && isOpen && closeOnEscape) onClose();
  };

  // Manage body scroll and restore focus
  useEffect(() => {
    if (isOpen) {
      previousFocus.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
      previousFocus.current?.focus();
    };
  }, [isOpen]);

  // Animate drawer entrance
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  // Delay unmount for exit animation
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
    } else {
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Focus first element inside drawer
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      const focusable = drawerRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    }
  }, [isOpen]);

  // Backdrop click handler
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (
      closeOnBackdropClick &&
      drawerRef.current &&
      !drawerRef.current.contains(e.target as Node)
    ) {
      onClose();
    }
  };

  if (!shouldRender) return null;

  const drawerContent = showBackdrop ? (
    <div
      className={cn("fixed inset-0 z-50 flex h-lvh max-w-full", {
        "items-start": position === "top",
        "items-end": position === "bottom",
        "justify-start": position === "left",
        "justify-end": position === "right",
      })}
      onClick={closeOnBackdropClick ? handleBackdropClick : undefined}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "drawer-title" : undefined}
      tabIndex={-1}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black transition-opacity duration-300 ease-in-out",
          isOpen ? "bg-opacity-50" : "bg-opacity-0 pointer-events-none"
        )}
        onClick={closeOnBackdropClick ? handleBackdropClick : undefined}
      />

      <div
        ref={drawerRef}
        className={cn(
          "relative bg-gray-800 shadow-2xl transition-transform duration-300 ease-in-out max-w-full max-h-dvh flex flex-col",
          positionClasses[position],
          position === "top" || position === "bottom"
            ? heightSizeClasses[size]
            : sizeClasses[size],
          className
        )}
        role="document"
        style={{ transform: getTransform(position, isOpen && isAnimating) }}
      >
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
            {title && (
              <h2
                id="drawer-title"
                className="text-xl font-semibold text-white"
              >
                {title}
              </h2>
            )}
            {showCloseButton && (
              <Button
                variant="tertiary"
                svg={X}
                onClick={onClose}
                iconSize="lg"
                className="ml-auto"
                aria-label="Close drawer"
              />
            )}
          </div>
        )}

        <div
          className={cn("scrollbar-variable", contentPadding, contentClassName)}
        >
          {children}
        </div>
      </div>
    </div>
  ) : (
    <div
      ref={drawerRef}
      className={cn(
        "fixed z-50 bg-gray-800 shadow-2xl transition-transform duration-300 ease-in-out max-w-full max-h-dvh flex flex-col",
        positionClasses[position],
        position === "top" || position === "bottom"
          ? heightSizeClasses[size]
          : sizeClasses[size],
        className
      )}
      role="dialog"
      aria-modal="false"
      aria-labelledby={title ? "drawer-title" : undefined}
      onKeyDown={handleKeyDown}
      style={{ transform: getTransform(position, isOpen && isAnimating) }}
    >
      {(title || showCloseButton) && (
        <div className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
          {title && (
            <h2 id="drawer-title" className="text-xl font-semibold text-white">
              {title}
            </h2>
          )}
          {showCloseButton && (
            <Button
              variant="tertiary"
              svg={X}
              onClick={onClose}
              iconSize="lg"
              className="ml-auto"
              aria-label="Close drawer"
            />
          )}
        </div>
      )}

      <div
        className={cn("scrollbar-variable", contentPadding, contentClassName)}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(
    drawerContent,
    document.getElementById("controller-main") || document.body
  );
};

export default Drawer;
