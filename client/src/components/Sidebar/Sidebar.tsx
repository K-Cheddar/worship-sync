import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/utils/cnHelper";

export const APP_SIDEBAR_WIDTH_CLASS = "w-44";
export const APP_SIDEBAR_GRID_CLASS = "lg:grid-cols-[11rem_minmax(0,1fr)]";

/** Shared surface and inset for navigation sidebars in application shells. */
const Sidebar = ({ className, children, ...props }: ComponentPropsWithoutRef<"aside">) => (
  <aside
    className={cn(
      "min-h-0 border-gray-700 bg-gray-950/70 p-2",
      className,
    )}
    {...props}
  >
    {children}
  </aside>
);

export default Sidebar;
