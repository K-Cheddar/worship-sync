"use client";
import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../utils/cnHelper";

type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root> & {
  color?: string;
  icon?: React.ReactNode;
};

const Switch = ({ className, color = "#06b6d4", icon, ...props }: SwitchProps) => {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group peer inline-flex h-[1.15rem] w-8 max-md:w-12 shrink-0 cursor-pointer items-center rounded-full border border-white shadow-xs outline-none transition-[background-color,border-color,box-shadow,filter] duration-150 ease-out focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=unchecked]:bg-gray-600 data-[state=unchecked]:enabled:hover:border-white/45 data-[state=unchecked]:enabled:hover:bg-gray-500",
        "data-[state=checked]:bg-(--switch-color) data-[state=checked]:enabled:hover:border-white/50 data-[state=checked]:enabled:hover:brightness-110 data-[state=checked]:enabled:hover:shadow-[0_0_12px_rgba(255,255,255,0.2)]",
        className
      )}
      style={{ "--switch-color": color } as React.CSSProperties}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none flex size-4 max-md:size-6 items-center justify-center rounded-full bg-background ring-0 transition-transform duration-150 ease-out group-hover:scale-105 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground"
        )}
      >
        {icon}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
};
export { Switch };
