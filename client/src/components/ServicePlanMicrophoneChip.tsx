import type { ReactNode } from "react";
import { cn } from "@/utils/cnHelper";
import { ServicePlanMicrophoneIcon } from "./ServicePlanMicrophoneIcon";
import { servicePlanMicrophoneChromeStyle } from "./servicePlanMicrophoneChrome";
import type { ServicePlanMicrophone } from "../types/servicePlan";

type ServicePlanMicrophoneChipProps = {
  microphone: ServicePlanMicrophone;
  className?: string;
  iconClassName?: string;
  /**
   * Extra muted segments after the name (type, holder). Joined with middots so
   * public and operator surfaces can share one chip shape.
   */
  details?: string[];
  /** Trailing controls such as a remove button on editable assignee rows. */
  children?: ReactNode;
};

const fallbackChromeClassName =
  "border-violet-500/30 bg-violet-950/40 text-violet-100";

/**
 * Read-only "this microphone is allocated here" pill. Shared by every surface
 * that lists an allocation it does not edit (Who's serving, the plan's item
 * rows) so a microphone looks the same wherever an operator meets it.
 * Catalog color tints the whole chrome when set; otherwise quiet violet.
 */
export const ServicePlanMicrophoneChip = ({
  microphone,
  className,
  iconClassName,
  details = [],
  children,
}: ServicePlanMicrophoneChipProps) => {
  const chromeStyle = servicePlanMicrophoneChromeStyle(microphone.color);
  const detailLabel = details
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
  const accessibleName = detailLabel
    ? `${microphone.name} · ${detailLabel}`
    : microphone.name;

  return (
    <span
      aria-label={accessibleName}
      className={cn(
        // Extra right padding when a remove control is slotted in — otherwise
        // the X sits flush against the pill edge on template/plan edit rows.
        "inline-flex min-w-0 items-center gap-1 rounded border py-0.5 text-[11px]",
        children ? "pl-1.5 pr-2" : "px-1",
        !chromeStyle && fallbackChromeClassName,
        className,
      )}
      style={chromeStyle}
    >
      <ServicePlanMicrophoneIcon
        microphone={microphone}
        color={microphone.color}
        className={cn("size-3.5 shrink-0", iconClassName)}
      />
      <span className="max-w-32 truncate">{microphone.name}</span>
      {detailLabel ? (
        <span className="max-w-40 truncate font-normal opacity-80">
          · {detailLabel}
        </span>
      ) : null}
      {children}
    </span>
  );
};

export default ServicePlanMicrophoneChip;
