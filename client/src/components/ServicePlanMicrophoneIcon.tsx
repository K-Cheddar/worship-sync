import { AudioLines, Headset, Mic, MicVocal, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/utils/cnHelper";
import { contrastingInkForFill, normalizeHexColor } from "../utils/richTextColorContrast";
import type { ServicePlanMicrophone } from "../types/servicePlan";

export const SERVICE_PLAN_MICROPHONE_CUSTOM_TYPE = "__custom__";

type ServicePlanMicrophoneIconName =
  | "handheld"
  | "lapel"
  | "headset"
  | "choir";

export const servicePlanMicrophoneTypeOptions: Array<{
  value: string;
  label: string;
}> = [
    { value: "Handheld", label: "Handheld" },
    { value: "Lapel", label: "Lapel" },
    { value: "Headset", label: "Headset" },
    { value: "Choir mic", label: "Choir mic / overhead" },
    { value: SERVICE_PLAN_MICROPHONE_CUSTOM_TYPE, label: "Custom type" },
  ];

const presetMicrophoneTypes = new Set(
  servicePlanMicrophoneTypeOptions
    .map((option) => option.value)
    .filter((type) => type !== SERVICE_PLAN_MICROPHONE_CUSTOM_TYPE),
);

export const isPresetServicePlanMicrophoneType = (type: string) =>
  presetMicrophoneTypes.has(type);

const microphoneIcons: Record<ServicePlanMicrophoneIconName, LucideIcon> = {
  handheld: MicVocal,
  lapel: Mic,
  headset: Headset,
  choir: AudioLines,
};

const inferredIconName = (type: string): ServicePlanMicrophoneIconName => {
  const normalizedType = type.toLowerCase();
  if (normalizedType.includes("headset")) return "headset";
  if (normalizedType.includes("lapel") || normalizedType.includes("lavalier")) {
    return "lapel";
  }
  if (normalizedType.includes("choir") || normalizedType.includes("overhead")) {
    return "choir";
  }
  return "handheld";
};

/** The glyph is derived from the type so it always matches the selected microphone style. */
export const getServicePlanMicrophoneIcon = (
  microphone: Pick<ServicePlanMicrophone, "type">,
): LucideIcon => {
  return microphoneIcons[inferredIconName(microphone.type)];
};

type ServicePlanMicrophoneIconProps = {
  microphone: Pick<ServicePlanMicrophone, "type">;
  className?: string;
  style?: CSSProperties;
  /**
   * When set, render the icon on a colored swatch with contrasting ink so dark
   * mic colors stay visible on dark surfaces.
   */
  color?: string;
};

export const ServicePlanMicrophoneIcon = ({
  microphone,
  className,
  style,
  color,
}: ServicePlanMicrophoneIconProps) => {
  const Icon = getServicePlanMicrophoneIcon(microphone);
  const fill = normalizeHexColor(color);

  if (!fill) {
    return <Icon className={className} style={style} aria-hidden />;
  }

  const ink = contrastingInkForFill(fill);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-current/40",
        className,
      )}
      style={{ backgroundColor: fill, color: ink, ...style }}
      aria-hidden
    >
      {/* `text-current` opts out of menu/select `[&_svg:not([class*='text-'])]` defaults */}
      <Icon className="size-[65%] text-current" style={{ color: ink }} />
    </span>
  );
};
