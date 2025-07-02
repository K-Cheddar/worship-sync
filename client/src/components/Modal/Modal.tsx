import { useEffect, useRef } from "react";
import Button from "../Button/Button";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import "./Modal.scss";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  showCloseButton?: boolean;
}

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  showCloseButton = true,
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
  }, [isOpen, onClose]);

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
      onClose();
    }
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

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${
        isOpen ? "block" : "hidden"
      }`}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title && "modal-title"}
      tabIndex={-1}
    >
      <div className="absolute inset-0 bg-black bg-opacity-50 transition-opacity" />

      <div
        ref={modalRef}
        className={`relative bg-gray-800 rounded-lg shadow-2xl w-full ${sizeClasses[size]} max-h-[90vh] overflow-hidden`}
        role="document"
      >
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between p-4">
            {title && (
              <h2 id="modal-title" className="text-xl font-semibold text-white">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <Button
                variant="tertiary"
                svg={CloseSVG}
                onClick={onClose}
                iconSize="lg"
                className="ml-auto"
                aria-label="Close modal"
              />
            )}
          </div>
        )}

        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
