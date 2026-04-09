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
};

const PopOver = ({ children, TriggeringButton, onOpenChange }: PopOverProps) => {
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{TriggeringButton}</PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className={cn(
          "w-auto max-w-[85vw] overflow-x-hidden rounded-lg border-2 border-gray-600 bg-gray-700 p-0 text-white shadow-2xl"
        )}
      >
        <div className="flex justify-end pr-2 pt-2">
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
        <div className="relative px-4 pb-4">{children}</div>
      </PopoverContent>
    </Popover>
  );
};

export default PopOver;
