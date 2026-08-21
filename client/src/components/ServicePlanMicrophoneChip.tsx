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
   * Extra muted segments after the type (e.g. holder). Joined with middots.
   * Type always comes from `microphone.type` so every surface shows it.
   */
  details?: string[];
  /** Trailing controls such as a remove button on editable assignee rows. */
  children?: ReactNode;
  theme?: "dark" | "light";
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
  theme = "dark",
}: ServicePlanMicrophoneChipProps) => {
  const chromeStyle = servicePlanMicrophoneChromeStyle(microphone.color);
  const themedChromeStyle = chromeStyle
    ? { ...chromeStyle, ...(theme === "light" ? { color: "#0f172a" } : {}) }
    : undefined;
  const detailLabel = [microphone.type, ...details]
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
        // shrink-0 + no max-width so name and type stay fully readable; parents
        // flex-wrap chips onto the next line instead of clipping them.
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border py-0.5 text-xs",
        children ? "pl-1.5 pr-2" : "px-1",
        !chromeStyle && (theme === "light"
          ? "border-slate-300 bg-slate-100 text-slate-900"
          : fallbackChromeClassName),
        className,
      )}
      style={themedChromeStyle}
    >
      <ServicePlanMicrophoneIcon
        microphone={microphone}
        color={microphone.color}
        className={cn("size-3.5 shrink-0", iconClassName)}
      />
      <span>{microphone.name}</span>
      {detailLabel ? (
        <span className="font-normal opacity-80">· {detailLabel}</span>
      ) : null}
      {children}
    </span>
  );
};

export default ServicePlanMicrophoneChip;
