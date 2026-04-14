import { cn } from "../../../utils/cnHelper";
import { toolbarTabClassName } from "./ToolbarButton";

type OutlinesPickerSkeletonProps = {
  className?: string;
  servicePanel?: boolean;
  matchToolbarTabs?: boolean;
};

const OutlinesPickerSkeleton = ({
  className,
  servicePanel = false,
  matchToolbarTabs = false,
}: OutlinesPickerSkeletonProps) => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading outlines"
    className={cn(
      "flex min-w-0 items-center gap-2",
      servicePanel &&
      "w-full max-w-none justify-center border-0 px-3 py-2.5 shadow-none",
      !servicePanel &&
      matchToolbarTabs &&
      cn(toolbarTabClassName(false, false), "max-w-64"),
      !servicePanel && !matchToolbarTabs && "max-w-64",
      className,
    )}
  >
    <div className="size-5 shrink-0 animate-pulse rounded-md bg-white/15" />
    <div
      className={cn(
        "h-4 shrink-0 animate-pulse rounded-md bg-white/10",
        servicePanel ? "min-w-0 flex-1" : "w-28",
      )}
    />
  </div>
);

export default OutlinesPickerSkeleton;
