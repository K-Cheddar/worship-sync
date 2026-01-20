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
        "peer data-[state=unchecked]:bg-gray-600 focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-[1.15rem] w-8 max-md:w-12 shrink-0 items-center rounded-full border border-white shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-(--switch-color) cursor-pointer",
        className
      )}
      style={{ "--switch-color": color } as React.CSSProperties}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 max-md:size-6 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 flex items-center justify-center"
        )}
      >
        {icon}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
};
export { Switch };
