"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/utils/cnHelper";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-slot="checkbox"
    className={cn(
      "peer size-4 shrink-0 rounded border border-gray-600 bg-gray-950 shadow-xs outline-none transition-colors",
      "focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/50",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-cyan-400 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-gray-950",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      data-slot="checkbox-indicator"
      className="flex items-center justify-center text-current"
    >
      <Check className="size-3 stroke-[3]" aria-hidden />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
