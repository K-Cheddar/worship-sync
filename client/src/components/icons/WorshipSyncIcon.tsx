import type { CSSProperties } from "react";
import { contrastRatio, contrastingInkForFill } from "../../utils/richTextColorContrast";
import { normalizePositionIcon, resolveWorshipSyncIcon, TablerGlyph } from "./iconRegistry";
import type { PositionIcon } from "./iconTypes";

type WorshipSyncIconProps = {
  icon?: PositionIcon | null;
  className?: string;
  "data-testid"?: string;
  "aria-hidden"?: boolean | "true" | "false";
};

const getGlyphStyle = (color?: string): CSSProperties | undefined => {
  if (!color) return undefined;
  const contrast = contrastRatio(color, "#111827");
  return {
    color,
    ...(contrast !== null && contrast < 2.5
      ? { filter: `drop-shadow(0 0 1px ${contrastingInkForFill(color)})` }
      : {}),
  };
};

/** Canonical renderer for position icons across Teams and Services. */
const WorshipSyncIcon = ({ icon, className, ...props }: WorshipSyncIconProps) => {
  const ref = normalizePositionIcon(icon);
  if (ref?.source === "tabler") {
    return <TablerGlyph name={ref.name} className={className} style={getGlyphStyle(ref.color)} aria-hidden {...props} />;
  }
  const Icon = resolveWorshipSyncIcon(ref);
  if (!Icon) return null;
  return <Icon className={className} style={getGlyphStyle(ref?.color)} aria-hidden {...props} />;
};

export default WorshipSyncIcon;
export type { IconRef, PositionIcon } from "./iconTypes";
