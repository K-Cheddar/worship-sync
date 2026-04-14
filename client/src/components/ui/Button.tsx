import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/utils/cnHelper";

const buttonVariants = cva(
  "cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        none: "",
        presentPrimary:
          "border-2 border-black bg-black font-semibold text-white hover:border-gray-900 hover:bg-gray-900 active:border-gray-800 active:bg-gray-800",
        presentSecondary:
          "border-2 border-gray-500 bg-gray-500 font-semibold text-white hover:border-gray-600 hover:bg-gray-600 active:border-gray-700 active:bg-gray-700",
        presentTertiary:
          "border-2 border-transparent bg-transparent font-semibold text-white hover:border-gray-500 hover:bg-gray-500 active:border-gray-400 active:bg-gray-400",
        presentCta:
          "border-2 border-cyan-600 bg-cyan-600 font-semibold text-white hover:border-cyan-700 hover:bg-cyan-700 active:border-cyan-800 active:bg-cyan-800",
        presentDestructive:
          "border-2 border-red-600 bg-red-600 font-semibold text-white hover:border-red-700 hover:bg-red-700 active:border-red-800 active:bg-red-800",
        presentTextLink:
          "h-auto min-h-0 max-md:min-h-0 border-0 bg-transparent p-0 font-normal text-sm text-cyan-400 underline underline-offset-2 shadow-none hover:text-cyan-300 active:text-cyan-400 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:font-normal disabled:text-gray-500 disabled:no-underline disabled:opacity-100 disabled:hover:text-gray-500",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
        present:
          "h-auto min-h-0 w-auto max-w-full rounded-md",
        bare: "h-auto min-h-0 p-0 shadow-none",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export { buttonVariants };

type ShadcnButtonProps = React.ComponentProps<"button"> &
  ButtonVariantProps & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ShadcnButtonProps>(
  (
    { className, variant = "default", size = "default", asChild = false, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export default Button;
