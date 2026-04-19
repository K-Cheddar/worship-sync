import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/utils/cnHelper"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-2xl p-[3px] text-muted-foreground shadow-xs transition-colors group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:p-0 data-[variant=line]:shadow-none",
  {
    variants: {
      variant: {
        default:
          "border border-border bg-muted dark:border-border",
        line:
          "flex w-full min-w-0 justify-start gap-0 rounded-xl border border-gray-700 bg-gray-900",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** Outer scrollable row for `variant="line"` tab lists (SectionTabs, mobile create-item, lyrics editor). */
export const lineTabsListShellClassName =
  "scrollbar-variable group-data-[orientation=horizontal]/tabs:h-auto h-auto min-h-0 min-w-0 w-full flex-nowrap items-stretch justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-xl bg-gray-900 p-0!"

/** Line-tab triggers: grow to fill the row (`flex-1`) but never narrower than label (`min-w-fit`); overflow scrolls on the shell. */
export const lineTabsTriggerClassName = cn(
  "relative inline-flex h-full min-h-0 min-w-fit flex-1 basis-0 items-center justify-center self-stretch whitespace-nowrap rounded-none border-r border-r-gray-600 px-4 py-2.5 text-sm font-semibold shadow-none transition-colors duration-150 first:rounded-l-xl last:rounded-r-xl last:border-r-0",
  "after:hidden group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-0",
  /** Inset rounded bar instead of border-b so the accent does not clash with outer strip radius (especially last tab). */
  "before:pointer-events-none before:absolute before:bottom-0 before:left-4 before:right-4 before:z-[2] before:h-0.5 before:rounded-full before:bg-cyan-500 before:opacity-0 before:transition-opacity before:duration-150 first:before:left-5 last:before:right-5 group-data-[variant=line]/tabs-list:data-[state=active]:before:opacity-100",
  "group-data-[variant=line]/tabs-list:data-[state=active]:border-b-2 group-data-[variant=line]/tabs-list:data-[state=active]:border-b-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-gray-950 group-data-[variant=line]/tabs-list:data-[state=active]:text-white group-data-[variant=line]/tabs-list:data-[state=active]:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
  "group-data-[variant=line]/tabs-list:data-[state=inactive]:border-b-2 group-data-[variant=line]/tabs-list:data-[state=inactive]:border-b-transparent group-data-[variant=line]/tabs-list:data-[state=inactive]:bg-gray-800 group-data-[variant=line]/tabs-list:data-[state=inactive]:text-gray-200 group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:bg-gray-700 group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:text-white",
  "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 group-data-[variant=default]/tabs-list:rounded-xl group-data-[variant=default]/tabs-list:border-2 group-data-[variant=default]/tabs-list:border-transparent group-data-[variant=default]/tabs-list:px-3 group-data-[variant=default]/tabs-list:py-1 group-data-[variant=line]/tabs-list:flex-1 group-data-[variant=line]/tabs-list:basis-0 group-data-[variant=line]/tabs-list:min-w-fit group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:px-2 group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=default]/tabs-list:data-[state=active]:border-border group-data-[variant=default]/tabs-list:data-[state=active]:bg-background group-data-[variant=default]/tabs-list:data-[state=active]:text-foreground",
        "after:absolute after:bg-cyan-500 after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
