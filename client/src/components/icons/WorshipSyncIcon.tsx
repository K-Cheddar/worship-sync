import type { CSSProperties } from "react";
import { normalizePositionIcon, resolveWorshipSyncIcon } from "./iconRegistry";
import type { PositionIcon } from "./iconTypes";

type WorshipSyncIconProps = {
  icon?: PositionIcon | null;
  className?: string;
  "data-testid"?: string;
  "aria-hidden"?: boolean | "true" | "false";
};

/** Canonical renderer for position icons across Teams and Services. */
const WorshipSyncIcon = ({ icon, className, ...props }: WorshipSyncIconProps) => {
  const ref = normalizePositionIcon(icon);
  const Icon = resolveWorshipSyncIcon(ref);
  if (!Icon) return null;
  const style: CSSProperties | undefined = ref?.color
    ? { color: ref.color }
    : undefined;
  return <Icon className={className} style={style} aria-hidden {...props} />;
};

export default WorshipSyncIcon;
export type { IconRef, PositionIcon } from "./iconTypes";
