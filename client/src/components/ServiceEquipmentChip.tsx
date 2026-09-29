import type { ReactNode } from "react";
import { cn } from "@/utils/cnHelper";
import type { ServiceEquipment } from "../types/servicePlan";
import { ServiceEquipmentIcon, getServiceEquipmentSubtypeLabel } from "./ServiceEquipmentIcon";

type ServiceEquipmentChipProps = {
  equipment: ServiceEquipment;
  className?: string;
  iconClassName?: string;
  details?: string[];
  children?: ReactNode;
};

export const ServiceEquipmentChip = ({
  equipment,
  className,
  iconClassName,
  details = [],
  children,
}: ServiceEquipmentChipProps) => {
  const detailLabel = [getServiceEquipmentSubtypeLabel(equipment.subtype), ...details]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
  const accessibleName = detailLabel ? `${equipment.name} · ${detailLabel}` : equipment.name;
  return (
    <span
      aria-label={accessibleName}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded border border-gray-700 bg-gray-900/70 py-0.5 text-xs text-gray-100",
        children ? "pl-1.5 pr-1" : "px-1",
        className,
      )}
    >
      <ServiceEquipmentIcon equipment={equipment} color={equipment.color} className={cn("size-4 shrink-0", iconClassName)} />
      <span className="min-w-0 flex-1 truncate">{equipment.name}</span>
      {detailLabel ? <span className="min-w-0 truncate font-normal text-gray-300">· {detailLabel}</span> : null}
      {children}
    </span>
  );
};

export default ServiceEquipmentChip;
