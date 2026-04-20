import * as React from "react";

import { cn } from "@/utils/cnHelper";

const Input = ({
  className,
  type,
  ...props
}: React.ComponentProps<"input">) => {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border border-neutral-500 bg-neutral-900 text-neutral-100 placeholder:text-neutral-400",
        "file:text-neutral-100 selection:bg-neutral-700 selection:text-neutral-100",
        "box-border min-h-9 w-full min-w-0 rounded-md px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-cyan-500/80 focus-visible:ring-cyan-500/35 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
};

export default Input;
