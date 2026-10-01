import { cn } from "@/utils/cnHelper";
import ColoredIconBadge from "../ColoredIconBadge";
import { normalizeHexColor } from "../../utils/richTextColorContrast";
import WorshipSyncIcon from "./WorshipSyncIcon";
import {
  ENTITY_ICON_DEFAULT_COLOR,
  type EntityIcon,
} from "./iconTypes";

export const getEntityIconColor = (
  icon?: EntityIcon | null,
): string => {
  if (typeof icon === "object" && icon?.color) {
    return normalizeHexColor(icon.color) || ENTITY_ICON_DEFAULT_COLOR;
  }
  return ENTITY_ICON_DEFAULT_COLOR;
};
/** @deprecated Use getEntityIconColor. */
export const getPositionIconColor = getEntityIconColor;

export type EntityIconBadgeProps = {
  icon?: EntityIcon | null;
  /** Render-only fill for candidate previews; never copied into the icon ref. */
  color?: string;
  /** Use picker-level CSS variables so a color drag does not update each tile. */
  preview?: boolean;
  className?: string;
  iconClassName?: string;
  "data-testid"?: string;
};
/** @deprecated Use EntityIconBadgeProps. */
export type PositionIconBadgeProps = EntityIconBadgeProps;

/** Shared neutral, contrast-aware surface for entity icons. */
const EntityIconBadge = ({
  icon,
  color,
  preview = false,
  className,
  iconClassName,
  "data-testid": dataTestId,
}: EntityIconBadgeProps) => {
  const fill = preview
    ? "var(--entity-icon-preview-fill)"
    : normalizeHexColor(color) || getEntityIconColor(icon);
  const inkColor = preview ? "var(--entity-icon-preview-ink)" : undefined;

  return (
    <ColoredIconBadge
      fillColor={fill}
      inkColor={inkColor}
      defaultColor={ENTITY_ICON_DEFAULT_COLOR}
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

export default EntityIconBadge;
/** @deprecated Use EntityIconBadge. */
export const PositionIconBadge = EntityIconBadge;
