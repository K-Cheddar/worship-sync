import { cn } from "@/utils/cnHelper";
import ColoredIconBadge from "../ColoredIconBadge";
import { normalizeHexColor } from "../../utils/richTextColorContrast";
import WorshipSyncIcon from "./WorshipSyncIcon";
import {
  POSITION_ICON_DEFAULT_COLOR,
  type PositionIcon,
} from "./iconTypes";

export const getPositionIconColor = (
  icon?: PositionIcon | null,
): string => {
  if (typeof icon === "object" && icon?.color) {
    return normalizeHexColor(icon.color) || POSITION_ICON_DEFAULT_COLOR;
  }
  return POSITION_ICON_DEFAULT_COLOR;
};

type PositionIconBadgeProps = {
  icon?: PositionIcon | null;
  /** Render-only fill for candidate previews; never copied into the icon ref. */
  color?: string;
  /** Use picker-level CSS variables so a color drag does not update each tile. */
  preview?: boolean;
  className?: string;
  iconClassName?: string;
  "data-testid"?: string;
};

/** Shared neutral, contrast-aware surface for position icons. */
const PositionIconBadge = ({
  icon,
  color,
  preview = false,
  className,
  iconClassName,
  "data-testid": dataTestId,
}: PositionIconBadgeProps) => {
  const fill = preview
    ? "var(--position-icon-preview-fill)"
    : normalizeHexColor(color) || getPositionIconColor(icon);
  const inkColor = preview ? "var(--position-icon-preview-ink)" : undefined;

  return (
    <ColoredIconBadge
      fillColor={fill}
      inkColor={inkColor}
      defaultColor={POSITION_ICON_DEFAULT_COLOR}
      className={cn("rounded-md", className)}
      data-testid={dataTestId}
    >
      {icon ? (
        <WorshipSyncIcon
          icon={icon}
          inheritColor
          className={cn("h-4 w-4 text-current", iconClassName)}
        />
      ) : null}
    </ColoredIconBadge>
  );
};

export default PositionIconBadge;
