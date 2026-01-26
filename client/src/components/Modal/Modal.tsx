import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Button from "../Button/Button";
import { X } from "lucide-react";
import cn from "classnames";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  showCloseButton?: boolean;
  contentPadding?: string;
  headerAction?: React.ReactNode;
  zIndexLevel?: 1 | 2;
}

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  "2xl": "max-w-7xl",
  full: "max-w-[95vw] max-md:w-full max-md:h-full max-md:max-w-none",
};

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  showCloseButton = true,
  contentPadding = "p-4",
  headerAction,
  zIndexLevel = 1,
}: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && isOpen) {
      onClose();
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Store the currently focused element
      previousActiveElement.current = document.activeElement as HTMLElement;
    }

    return () => {
      // Restore focus to the previous element
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen]);

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
      onClose();
    }
  };

  const handleModalContentClick = (event: React.MouseEvent) => {
    // Prevent clicks inside the modal from propagating outside
    event.stopPropagation();
  };

  useEffect(() => {
    if (isOpen && modalRef.current) {
      // Focus the modal when it opens
      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstFocusableElement = focusableElements[0] as HTMLElement;
      if (firstFocusableElement) {
        firstFocusableElement.focus();
      }
    }
  }, [isOpen]);

  // Find the controller element to use as portal target
  const getControllerElement = () => {
    // Look for the controller main element by ID
    const controllerMain = document.getElementById("controller-main");
    if (controllerMain) {
      return controllerMain;
    }

    // Fallback to body if controller is not found
    return document.body;
  };

  const zIndexClass = zIndexLevel === 2 ? "z-[55]" : "z-50";

  const modalContent = (
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center p-4",
        zIndexClass,
        size === "full" ? "max-md:p-0" : "p-4",
        isOpen ? "block" : "hidden"
      )}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title && "modal-title"}
      tabIndex={-1}
    >
      <div className="absolute inset-0 bg-black/50 transition-opacity" />

      <div
        ref={modalRef}
        className={cn(
          "relative bg-gray-800 shadow-2xl w-full overflow-hidden",
          size === "full" ? "max-md:rounded-none max-md:h-full" : "rounded-lg max-h-[90vh] max-md:max-h-[95vh] max-md:rounded-none",
          sizeClasses[size]
        )}
        role="document"
        onClick={handleModalContentClick}
      >
        {(title || showCloseButton || headerAction) && (
          <div className="flex items-center justify-between p-4">
            {title && (
              <h2 id="modal-title" className="text-xl font-semibold text-white">
                {title}
              </h2>
            )}
            <div className="ml-auto flex items-center gap-2">
              {headerAction}
              {showCloseButton && (
                <Button
                  variant="tertiary"
                  svg={X}
                  onClick={onClose}
                  iconSize="lg"
                  aria-label="Close modal"
                />
              )}
            </div>
          </div>
        )}

        <div
          className={cn(
            "overflow-y-auto max-h-[calc(90vh-120px)] max-md:max-h-[calc(100vh)] scrollbar-variable",
            contentPadding
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );

  // Use portal to render modal into controller element
  return createPortal(modalContent, getControllerElement());
};

export default Modal;
