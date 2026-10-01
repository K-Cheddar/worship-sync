import { normalizePositionIcon, resolveWorshipSyncIcon, TablerGlyph } from "./iconRegistry";
import type { PositionIcon } from "./iconTypes";

type WorshipSyncIconProps = {
  icon?: PositionIcon | null;
  className?: string;
  /** Presentation-only ink override; does not alter the persisted icon ref. */
  color?: string;
  /** Inherit the badge's contrasting ink instead of the color on the icon ref. */
  inheritColor?: boolean;
  "data-testid"?: string;
  "aria-hidden"?: boolean | "true" | "false";
};

/** Canonical renderer for position icons across Teams and Services. */
const WorshipSyncIcon = ({ icon, className, color, inheritColor = false, ...props }: WorshipSyncIconProps) => {
  const ref = normalizePositionIcon(icon);
  const glyphColor = inheritColor ? undefined : color ?? ref?.color;
  const style = glyphColor ? { color: glyphColor } : undefined;
  if (ref?.source === "tabler") {
    return <TablerGlyph name={ref.name} className={className} style={style} aria-hidden {...props} />;
  }
  const Icon = resolveWorshipSyncIcon(ref);
  if (!Icon) return null;
  return <Icon className={className} style={style} aria-hidden {...props} />;
};

export default WorshipSyncIcon;
export type { IconRef, PositionIcon } from "./iconTypes";
