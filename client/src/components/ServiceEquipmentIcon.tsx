import { Cable, Headphones, Radio, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import ColoredIconBadge from "./ColoredIconBadge";
import type { ServiceEquipment } from "../types/servicePlan";

export const SERVICE_EQUIPMENT_DEFAULT_COLOR = "#9ca3af";
export const NEW_SERVICE_EQUIPMENT_COLOR = "#f97316";
export const SERVICE_EQUIPMENT_CUSTOM_SUBTYPE = "__custom__";

export const serviceEquipmentSubtypeOptions = [
  { value: "wireless-beltpack", label: "Wireless beltpack" },
  { value: "wired-beltpack", label: "Wired beltpack" },
  { value: "personal-monitor", label: "Personal monitor" },
  { value: SERVICE_EQUIPMENT_CUSTOM_SUBTYPE, label: "Custom type" },
] as const;

const presetSubtypes = new Set<string>(
  serviceEquipmentSubtypeOptions
    .map(({ value }) => value)
    .filter((value) => value !== SERVICE_EQUIPMENT_CUSTOM_SUBTYPE),
);

export const isPresetServiceEquipmentSubtype = (subtype: string | undefined) =>
  Boolean(subtype && presetSubtypes.has(subtype as (typeof serviceEquipmentSubtypeOptions)[number]["value"]));

export const getServiceEquipmentSubtypeLabel = (subtype: string | undefined) =>
  serviceEquipmentSubtypeOptions.find((option) => option.value === subtype)?.label
  || subtype?.trim()
  || "IEM";

export const getServiceEquipmentIcon = (
  equipment: Pick<ServiceEquipment, "subtype">,
): LucideIcon => {
  switch (equipment.subtype) {
    case "wireless-beltpack": return Radio;
    case "wired-beltpack": return Cable;
    default: return Headphones;
  }
};

type ServiceEquipmentIconProps = {
  equipment: Pick<ServiceEquipment, "subtype">;
  className?: string;
  style?: CSSProperties;
  color?: string;
};

export const ServiceEquipmentIcon = ({
  equipment,
  className,
  style,
  color,
}: ServiceEquipmentIconProps) => {
  const Icon = getServiceEquipmentIcon(equipment);
  return (
    <ColoredIconBadge
      fillColor={color || SERVICE_EQUIPMENT_DEFAULT_COLOR}
      defaultColor={SERVICE_EQUIPMENT_DEFAULT_COLOR}
      className={className}
      style={style}
    >
      <Icon className="size-[90%] text-current" />
    </ColoredIconBadge>
  );
};
