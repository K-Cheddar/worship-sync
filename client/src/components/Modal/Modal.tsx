import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import Button from "../Button/Button";
import { X } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import { OverlayPortalProvider, useOverlayPortalContainer } from "@/components/FloatingWindow/FloatingWindowPortalContext";
import { FLOATING_WINDOW_DOCK_Z } from "@/components/FloatingWindow/FloatingWindowZIndexContext";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "fit" | "full";
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
  /** Accessible description for screen readers; hidden visually by default. */
  description?: string;
  /** IDs of visible explanatory content, instead of a duplicate hidden description. */
  descriptionId?: string;
  ariaLabel?: string;
  /** Blocks close controls, outside interaction and Escape during an action. */
  busy?: boolean;
  onCloseAutoFocus?: React.ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  "2xl": "max-w-7xl",
  fit: "w-fit max-w-[calc(100%-2rem)]",
  full: "inset-0 left-0 top-0 h-full max-h-full w-full max-w-none translate-x-0 translate-y-0 p-0",
};

const getControllerElement = (ownerDocument: Document = document) => {
  const controllerMain = ownerDocument.getElementById("controller-main");
  return controllerMain ?? ownerDocument.body;
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
  description,
  descriptionId,
  ariaLabel,
  busy = false,
  onCloseAutoFocus,
}: ModalProps) => {
  const overlayPortalContainer = useOverlayPortalContainer();
  const ownerDocument = overlayPortalContainer?.ownerDocument ?? document;
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Nested portals share this stacking layer without the surface's clipping/transform.
  const [dialogHost, setDialogHost] = useState<HTMLDivElement | null>(null);
  const handleClose = () => { if (!busy) onClose(); };

  const zIndexClass = zIndexLevel === 2 ? "z-[55]" : "z-50";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogPortal
        container={
          overlayPortalContainer ??
          getControllerElement(ownerDocument)
        }
      >
        <div
          ref={setDialogHost}
          data-testid="modal-overlay-host"
          data-state={isOpen ? "open" : "closed"}
          className="pointer-events-none fixed inset-0 isolate data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200"
          style={{ zIndex: overlayPortalContainer ? (zIndexLevel === 2 ? 55 : 50) : FLOATING_WINDOW_DOCK_Z + zIndexLevel }}
        >
          <OverlayPortalProvider container={dialogHost ?? overlayPortalContainer}>
            <DialogOverlay className={cn(zIndexClass, backdropClassName)} />
            <DialogContent
              aria-label={ariaLabel}
              {...(descriptionId ? { "aria-describedby": descriptionId } : {})}
              aria-busy={busy || undefined}
              onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
              onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
              onOpenAutoFocus={() => {
                returnFocusRef.current = ownerDocument.activeElement as HTMLElement | null;
              }}
              onCloseAutoFocus={(event) => {
                if (onCloseAutoFocus) { onCloseAutoFocus(event); return; }
                if (returnFocusRef.current?.isConnected) {
                  event.preventDefault();
                  returnFocusRef.current.focus();
                }
              }}
              style={{ pointerEvents: "auto" }}
              className={cn(
                "fixed left-1/2 top-1/2 flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border-0 bg-transparent p-0 shadow-none outline-none",
                "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200",
                zIndexClass,
                sizeClasses[size],
                size !== "full" && "max-h-[90vh]"
              )}
            >
              {!(title || showCloseButton || headerAction) && (
                <DialogTitle className="sr-only">{ariaLabel ?? "Dialog"}</DialogTitle>
              )}
              {!descriptionId && <DialogDescription className="sr-only">
                {description || "Dialog content"}
              </DialogDescription>}
              <div
                className={cn(
                  "relative flex w-full min-h-0 flex-1 flex-col overflow-hidden shadow-2xl",
                  surfaceClassName
                    ? surfaceClassName
                    : cn(
                      "bg-gray-800",
                      size === "full"
                        ? "h-full rounded-none"
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
                      aria-label={ariaLabel}
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
                          onClick={handleClose}
                          disabled={busy}
                          iconSize="lg"
                          aria-label="Close modal"
                        />
                      )}
                    </div>
                  </div>
                )}

                <div
                  className={cn(
                    "min-h-0 flex-1",
                    size === "full"
                      ? "flex max-h-none flex-col overflow-hidden"
                      : size === "fit"
                        ? "max-h-[calc(100vh-8rem)] overflow-hidden"
                      : "max-h-[calc(90vh-120px)] overflow-y-auto scrollbar-variable max-md:max-h-[calc(100vh)]",
                    contentPadding
                  )}
                >
                  {children}
                </div>
              </div>
            </DialogContent>
          </OverlayPortalProvider>
        </div>
      </DialogPortal>
    </Dialog>
  );
};

export default Modal;
