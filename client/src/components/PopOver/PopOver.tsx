import { ReactElement, type ComponentProps } from "react";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import Button from "../Button/Button";
import { X } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import { ButtonProps } from "../Button/Button";

type PopOverProps = {
  children: React.ReactNode;
  TriggeringButton: ReactElement<ButtonProps>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Merged onto the popover surface (border, background, width, etc.). */
  contentClassName?: string;
  /** Merged onto the inner body wrapper around `children`. */
  bodyClassName?: string;
  /** Merged onto the top row that contains the close control. */
  headerRowClassName?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  /** Render the menu inline instead of in a portal. Needed inside a
   * FloatingWindow, whose stacking context a portaled menu escapes. */
  disablePortal?: boolean;
  /**
   * Forwarded to Radix PopoverContent. Use e.g. onFocusOutside preventDefault
   * when a child (color wheel) must restore selection into another field
   * without dismissing the popover.
   */
  onFocusOutside?: ComponentProps<typeof PopoverContent>["onFocusOutside"];
  onPointerDownOutside?: ComponentProps<typeof PopoverContent>["onPointerDownOutside"];
  onInteractOutside?: ComponentProps<typeof PopoverContent>["onInteractOutside"];
  onOpenAutoFocus?: ComponentProps<typeof PopoverContent>["onOpenAutoFocus"];
};

const PopOver = ({
  children,
  TriggeringButton,
  open,
  onOpenChange,
  contentClassName,
  bodyClassName,
  headerRowClassName,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  disablePortal,
  onFocusOutside,
  onPointerDownOutside,
  onInteractOutside,
  onOpenAutoFocus,
}: PopOverProps) => {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{TriggeringButton}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        portal={!disablePortal}
        className={cn(
          "w-auto max-w-[85vw] overflow-x-hidden rounded-md border border-gray-600 bg-gray-800 p-0 text-white shadow-md",
          contentClassName,
        )}
        onFocusOutside={onFocusOutside}
        onPointerDownOutside={onPointerDownOutside}
        onInteractOutside={onInteractOutside}
        onOpenAutoFocus={onOpenAutoFocus}
      >
        <div
          className={cn("flex justify-end pr-2 pt-2", headerRowClassName)}
        >
          <PopoverClose asChild>
            <Button
              type="button"
              variant="tertiary"
              svg={X}
              aria-label="Close popover"
              className="shrink-0"
            />
          </PopoverClose>
        </div>
        <div className={cn("relative px-4 pb-4", bodyClassName)}>{children}</div>
      </PopoverContent>
    </Popover>
  );
};

export default PopOver;
