import { type CSSProperties, type ReactNode, type Ref, useMemo } from "react";
import { ChevronRight, MoreVertical, Pencil } from "lucide-react";
import Button from "../../../components/Button/Button";
import Menu from "../../../components/Menu/Menu";
import type { MenuItemType } from "../../../types";
import { cn } from "@/utils/cnHelper";
import { resolvePositionLucideIcon } from "../lucidePositionIcons";
import {
  teamsRowIconButtonClassName,
  teamsRowIconButtonPadding,
} from "../teamsStyles";

type EntityRowProps = {
  title: string;
  subtitle?: string;
  /** Secondary detail shown below subtitle with reduced emphasis (e.g. member notes). */
  note?: string;
  icon?: string;
  archived?: boolean;
  /** Compact row: smaller title, hides note. */
  compact?: boolean;
  /** Opens edit mode; the row becomes fully clickable with a hover affordance. */
  onTitleClick?: () => void;
  onEdit?: () => void;
  canEdit?: boolean;
  onArchive?: () => void;
  onDelete?: () => void;
  actions?: ReactNode;
  /** Drag handle rendered at the start of the row when the list is sortable. */
  dragHandle?: ReactNode;
  /** Root element ref, used by the sortable wrapper. */
  rowRef?: Ref<HTMLDivElement>;
  /** Inline style for the root element (sortable transform/transition). */
  style?: CSSProperties;
};

const EntityRow = ({
  title,
  subtitle,
  note,
  icon,
  archived,
  compact = false,
  onTitleClick,
  onEdit,
  canEdit = true,
  onArchive,
  onDelete,
  actions,
  dragHandle,
  rowRef,
  style,
}: EntityRowProps) => {
  const IconComponent = resolvePositionLucideIcon(icon);
  const menuItems = useMemo(() => {
    const items: MenuItemType[] = [];
    if (!canEdit) return items;
    if (!archived && onArchive) {
      items.push({ text: "Archive", onClick: onArchive });
    }
    if (onDelete) {
      items.push({ text: "Delete", variant: "destructive", onClick: onDelete });
    }
    return items;
  }, [archived, canEdit, onArchive, onDelete]);

  const isClickable = Boolean(canEdit && onTitleClick);
  const titleClassName = compact
    ? "truncate text-sm font-medium text-gray-100"
    : "truncate font-semibold text-white";

  const rowContent = (
    <>
      {IconComponent ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cyan-300/30 bg-cyan-400/10 text-cyan-100">
          <IconComponent className="h-4 w-4" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className={titleClassName}>{title}</p>
          {archived ? (
            <span className="shrink-0 rounded border border-gray-600 px-1.5 py-0.5 text-xs text-gray-300">
              Archived
            </span>
          ) : null}
        </div>
        {subtitle ? (
          <p
            className={cn(
              compact
                ? "mt-0.5 truncate text-xs text-gray-400"
                : "mt-1 text-sm leading-relaxed text-gray-300",
            )}
          >
            {subtitle}
          </p>
        ) : null}
        {!compact && note ? (
          <p className="mt-1 text-xs leading-relaxed text-gray-500">{note}</p>
        ) : null}
      </div>
      {isClickable ? (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-gray-500 group-hover:text-gray-300"
          aria-hidden
        />
      ) : null}
    </>
  );

  return (
    <div
      ref={rowRef}
      style={style}
      className={cn(
        "group flex rounded-lg border border-gray-800 bg-gray-950/40",
        compact
          ? "items-center gap-2 p-2"
          : "flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between",
        isClickable &&
        "cursor-pointer transition-colors hover:border-gray-600/80 hover:bg-gray-900/60",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 gap-2",
          compact ? "flex-1 items-center" : "w-full items-start sm:flex-1",
        )}
      >
        {dragHandle}
        {isClickable ? (
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400",
              compact ? "" : "w-full",
            )}
            aria-label={`Edit ${title}`}
            onClick={onTitleClick}
          >
            {rowContent}
          </button>
        ) : (
          <div
            className={cn(
              "flex min-w-0 gap-2",
              compact ? "flex-1 items-center" : "w-full items-start",
            )}
          >
            {rowContent}
          </div>
        )}
      </div>
      {actions || !isClickable ? (
        <div className={cn("flex shrink-0 items-center gap-1", compact ? "" : "self-start")}>
          {actions}
          {!isClickable && canEdit && onEdit ? (
            <Button
              variant="tertiary"
              svg={Pencil}
              iconSize="sm"
              className={teamsRowIconButtonClassName}
              padding={teamsRowIconButtonPadding}
              aria-label={`Edit ${title}`}
              onClick={onEdit}
            >
              Edit
            </Button>
          ) : null}
          {!isClickable && menuItems.length > 0 ? (
            <Menu
              align="end"
              menuItems={menuItems}
              TriggeringButton={
                <Button
                  variant="tertiary"
                  svg={MoreVertical}
                  iconSize="sm"
                  className={teamsRowIconButtonClassName}
                  padding={teamsRowIconButtonPadding}
                  aria-label={`More actions for ${title}`}
                />
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default EntityRow;
