import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCallback } from "react";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import Button from "../Button/Button";
import { X } from "lucide-react";
import { cn } from "@/utils/cnHelper";

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
  /** Merged onto the backdrop layer (default: bg-black/50). */
  backdropClassName?: string;
  /** Merged onto the modal panel (default: bg-gray-800 …). */
  surfaceClassName?: string;
  /** Merged onto the header row (title + close). */
  headerClassName?: string;
  /** Merged onto the title element. */
  titleClassName?: string;
}

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  "2xl": "max-w-7xl",
  full: "max-w-[95vw] max-md:w-full max-md:h-full max-md:max-w-none",
};

const getControllerElement = () => {
  const controllerMain = document.getElementById("controller-main");
  return controllerMain ?? document.body;
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
  backdropClassName,
  surfaceClassName,
  headerClassName,
  titleClassName,
}: ModalProps) => {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose]
  );

  const zIndexClass = zIndexLevel === 2 ? "z-[55]" : "z-50";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogPortal container={getControllerElement()}>
        <DialogOverlay className={cn(zIndexClass, backdropClassName)} />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border-0 bg-transparent p-0 shadow-none outline-none",
            zIndexClass,
            sizeClasses[size],
            size === "full" &&
            "max-md:inset-0 max-md:left-0 max-md:top-0 max-md:h-full max-md:max-h-full max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:p-0",
            size !== "full" && "max-h-[90vh]"
          )}
        >
          {!(title || showCloseButton || headerAction) && (
            <DialogTitle className="sr-only">Dialog</DialogTitle>
          )}
          <div
            className={cn(
              "relative flex w-full min-h-0 flex-1 flex-col overflow-hidden shadow-2xl",
              surfaceClassName
                ? surfaceClassName
                : cn(
                  "bg-gray-800",
                  size === "full"
                    ? "max-md:h-full max-md:rounded-none"
                    : "rounded-lg max-md:max-h-[95vh] max-md:rounded-none"
                )
            )}
          >
            {(title || showCloseButton || headerAction) && (
              <div
                className={cn(
                  "flex shrink-0 items-center justify-between p-4",
                  headerClassName
                )}
              >
                <DialogTitle
                  className={cn(
                    !title && "sr-only",
                    title && cn("text-xl font-semibold text-white", titleClassName)
                  )}
                >
                  {title ?? "Dialog"}
                </DialogTitle>
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
                "min-h-0 flex-1 overflow-y-auto max-h-[calc(90vh-120px)] max-md:max-h-[calc(100vh)] scrollbar-variable",
                contentPadding
              )}
            >
              {children}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};

export default Modal;
