import * as React from "react";

import { cn } from "@/utils/cnHelper";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "border border-neutral-700 bg-neutral-900 text-neutral-100 placeholder:text-neutral-400",
        "selection:bg-neutral-700 selection:text-neutral-100",
        "w-full min-w-0 min-h-0 rounded-md px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-cyan-500/80 focus-visible:ring-cyan-500/35 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export default Textarea;
