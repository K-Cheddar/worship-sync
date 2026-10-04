import type { ReactNode } from "react";
import { cn } from "@/utils/cnHelper";
import type { ServiceEquipment } from "../types/servicePlan";
import { ServiceEquipmentIcon, getServiceEquipmentSubtypeLabel } from "./ServiceEquipmentIcon";
import { servicePlanEquipmentChromeStyle } from "./servicePlanMicrophoneChrome";

type ServiceEquipmentChipProps = {
  equipment: ServiceEquipment;
  className?: string;
  iconClassName?: string;
  details?: string[];
  children?: ReactNode;
  theme?: "dark" | "light";
};

export const ServiceEquipmentChip = ({
  equipment,
  className,
  iconClassName,
  details = [],
  children,
  theme = "dark",
}: ServiceEquipmentChipProps) => {
  const chromeStyle = servicePlanEquipmentChromeStyle(equipment.color);
  const themedChromeStyle = chromeStyle
    ? { ...chromeStyle, ...(theme === "light" ? { color: "#0f172a" } : {}) }
    : undefined;
  const detailLabel = [getServiceEquipmentSubtypeLabel(equipment.subtype), ...details]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
  const accessibleName = detailLabel ? `${equipment.name} · ${detailLabel}` : equipment.name;
  return (
    <span
      aria-label={accessibleName}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded border py-0.5 text-xs",
        children ? "pl-1.5 pr-1" : "px-1",
        !chromeStyle && (theme === "light"
          ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-950"
          : "border-fuchsia-700/60 bg-fuchsia-950/50 text-fuchsia-100"),
        className,
      )}
      style={themedChromeStyle}
    >
      <ServiceEquipmentIcon equipment={equipment} color={equipment.color} className={cn("size-4 shrink-0", iconClassName)} />
      <span className="min-w-0 flex-1 truncate">{equipment.name}</span>
      {detailLabel ? (
        <span
          className={cn(
            "min-w-0 truncate font-normal",
            chromeStyle
              ? "opacity-80"
              : theme === "light"
                ? "text-fuchsia-800/80"
                : "text-fuchsia-200",
          )}
        >
          · {detailLabel}
        </span>
      ) : null}
      {children}
    </span>
  );
};

export default ServiceEquipmentChip;
