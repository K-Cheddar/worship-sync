import { ReactElement } from "react";
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
};

const PopOver = ({
  children,
  TriggeringButton,
  onOpenChange,
  contentClassName,
  bodyClassName,
  headerRowClassName,
  align = "end",
  side = "bottom",
  sideOffset = 4,
}: PopOverProps) => {
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{TriggeringButton}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "w-auto max-w-[85vw] overflow-x-hidden rounded-md border border-gray-600 bg-gray-800 p-0 text-white shadow-md",
          contentClassName,
        )}
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
