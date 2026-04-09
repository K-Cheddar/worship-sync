import React, { useCallback, useEffect } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/utils/cnHelper";
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
  md: "w-[25%]",
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

const sheetSideByPosition: Record<
  NonNullable<DrawerProps["position"]>,
  "left" | "right" | "top" | "bottom"
> = {
  left: "left",
  right: "right",
  top: "top",
  bottom: "bottom",
};

const getControllerElement = (): HTMLElement | undefined => {
  if (typeof document === "undefined") return undefined;
  return document.getElementById("controller-main") ?? document.body;
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
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose]
  );

  const side = sheetSideByPosition[position];

  const dimensionClass =
    position === "top" || position === "bottom"
      ? heightSizeClasses[size]
      : sizeClasses[size];

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange} modal={showBackdrop}>
      <SheetContent
        side={side}
        container={getControllerElement()}
        showOverlay={showBackdrop}
        showClose={false}
        className={cn("max-w-full max-h-dvh", dimensionClass, className)}
        onPointerDownOutside={(e) => {
          if (!showBackdrop || !closeOnBackdropClick) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (!showBackdrop || !closeOnBackdropClick) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!closeOnEscape) e.preventDefault();
        }}
        aria-describedby={undefined}
      >
        {title || showCloseButton ? (
          <div className="flex shrink-0 items-center justify-between border-b border-gray-700 p-4">
            {title ? (
              <SheetTitle className="text-xl font-semibold text-white">
                {title}
              </SheetTitle>
            ) : (
              <SheetTitle className="sr-only">Drawer</SheetTitle>
            )}
            {showCloseButton ? (
              <Button
                variant="tertiary"
                svg={X}
                onClick={onClose}
                iconSize="lg"
                className="ml-auto"
                aria-label="Close drawer"
              />
            ) : null}
          </div>
        ) : (
          <SheetTitle className="sr-only">Drawer</SheetTitle>
        )}

        <div
          className={cn("scrollbar-variable", contentPadding, contentClassName)}
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default Drawer;
