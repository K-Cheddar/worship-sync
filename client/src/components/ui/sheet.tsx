import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/utils/cnHelper";

const Sheet = ({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) => {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
};

const SheetTrigger = ({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) => {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
};

const SheetClose = ({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) => {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
};

const SheetPortal = ({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) => {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
};

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 duration-400 ease-out",
        className
      )}
      {...props}
    />
  );
}

type SheetContentProps = React.ComponentProps<
  typeof DialogPrimitive.Content
> & {
  side?: "left" | "right" | "top" | "bottom";
  /** When set, portals into this element (e.g. `#controller-main`). */
  container?: HTMLElement | null;
  /** When false, no overlay is rendered (e.g. edge drawer without dimming). */
  showOverlay?: boolean;
  /** When false, omits the default corner close control. */
  showClose?: boolean;
};

function SheetContent({
  side = "right",
  container,
  showOverlay = true,
  showClose = true,
  className,
  children,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal container={container ?? undefined}>
      {showOverlay ? <SheetOverlay /> : null}
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex min-h-0 w-full flex-col overflow-hidden border-gray-600 bg-gray-800 text-white shadow-xl outline-none duration-400 ease-out",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          side === "right" &&
          "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full max-h-[100dvh] max-w-md border-l",
          side === "left" &&
          "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full max-h-[100dvh] max-w-md border-r",
          side === "top" &&
          "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 max-h-[85dvh] border-b",
          side === "bottom" &&
          "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 max-h-[85dvh] border-t",
          className
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-md opacity-80 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0"
            aria-label="Close"
          >
            <XIcon className="text-white" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex flex-col gap-1.5 border-b border-gray-600 px-6 py-5 pr-14",
        className
      )}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Title>, "id">) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "text-lg font-semibold tracking-tight text-white",
        className
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-gray-400", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
