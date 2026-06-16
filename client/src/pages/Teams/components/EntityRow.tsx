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
  /** Custom metadata below the title; takes precedence over `subtitle` when set. */
  details?: ReactNode;
  /** Badge shown next to the title or pinned to the top-right of the card. */
  headerBadge?: ReactNode;
  /** Where `headerBadge` is rendered. Defaults to `inline`. */
  headerBadgePlacement?: "inline" | "top-end";
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
  /** Where `actions` render on non-compact rows. Defaults to `aside`. */
  actionsPlacement?: "aside" | "footer-end";
  /** Drag handle rendered at the start of the row when the list is sortable. */
  dragHandle?: ReactNode;
  /** When false, hides the chevron on clickable rows. Defaults to true. */
  showChevron?: boolean;
  /** Root element ref, used by the sortable wrapper. */
  rowRef?: Ref<HTMLDivElement>;
  /** Inline style for the root element (sortable transform/transition). */
  style?: CSSProperties;
};

const EntityRow = ({
  title,
  subtitle,
  details,
  headerBadge,
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
  actionsPlacement = "aside",
  dragHandle,
  showChevron = true,
  headerBadgePlacement = "inline",
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
  const showInlineBadge = Boolean(headerBadge) && headerBadgePlacement === "inline";
  const showCornerBadge = Boolean(headerBadge) && headerBadgePlacement === "top-end";
  const useFooterActions = !compact && actionsPlacement === "footer-end" && Boolean(actions);
  const useHeaderActions =
    !compact && isClickable && Boolean(actions) && actionsPlacement === "aside";
  const useStackedCardLayout = !compact && isClickable && (showCornerBadge || useFooterActions);
  const titleClassName = compact
    ? "truncate text-sm font-medium text-gray-100"
    : "truncate font-semibold text-white";

  const titleBlock = (
    <div className="flex min-w-0 items-center gap-2">
      <p className={titleClassName}>{title}</p>
      {archived ? (
        <span className="shrink-0 rounded border border-gray-600 px-1.5 py-0.5 text-xs text-gray-300">
          Archived
        </span>
      ) : null}
      {showInlineBadge ? headerBadge : null}
    </div>
  );

  const metaBlock = (
    <>
      {details ?? (subtitle ? (
        <p
          className={cn(
            compact
              ? "mt-0.5 truncate text-xs text-gray-400"
              : "mt-1 text-sm leading-relaxed text-gray-300",
          )}
        >
          {subtitle}
        </p>
      ) : null)}
      {!compact && note ? (
        <p className="mt-1 text-xs leading-relaxed text-gray-500">{note}</p>
      ) : null}
    </>
  );

  const rowContent = (
    <>
      {IconComponent ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cyan-300/30 bg-cyan-400/10 text-cyan-100">
          <IconComponent className="h-4 w-4" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {titleBlock}
        {metaBlock}
      </div>
      {isClickable && showChevron ? (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-gray-500 group-hover:text-gray-300"
          aria-hidden
        />
      ) : null}
    </>
  );

  const stackedCardBody = (
    <>
      {IconComponent ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cyan-300/30 bg-cyan-400/10 text-cyan-100">
          <IconComponent className="h-4 w-4" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {titleBlock}
        {metaBlock}
      </div>
    </>
  );

  const clickableBody = isClickable ? (
    <button
      type="button"
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-2 rounded-md text-left",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400",
        useStackedCardLayout || useHeaderActions
          ? "flex-1"
          : compact
            ? "flex-1"
            : "w-full flex-1",
      )}
      aria-label={`Edit ${title}`}
      onClick={onTitleClick}
    >
      {useStackedCardLayout ? stackedCardBody : rowContent}
    </button>
  ) : (
    <div
      className={cn(
        "flex min-w-0 gap-2",
        compact ? "flex-1 items-center" : "w-full flex-1 items-start",
      )}
    >
      {rowContent}
    </div>
  );

  return (
    <div
      ref={rowRef}
      style={style}
      className={cn(
        "group flex rounded-lg border border-gray-800 bg-gray-950/40",
        compact
          ? "items-center gap-2 p-2"
          : useStackedCardLayout || useHeaderActions
            ? "flex-col gap-3 p-3"
            : "flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between",
        isClickable &&
        "cursor-pointer transition-colors hover:border-gray-600/80 hover:bg-gray-900/60",
      )}
    >
      {useStackedCardLayout ? (
        <>
          <div className="flex w-full items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              {dragHandle}
              {clickableBody}
            </div>
            {showCornerBadge ? (
              <div className="shrink-0">{headerBadge}</div>
            ) : null}
          </div>
          {useFooterActions ? (
            <div className="flex justify-end">{actions}</div>
          ) : null}
        </>
      ) : useHeaderActions ? (
        <div className="flex w-full items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            {dragHandle}
            {clickableBody}
          </div>
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        </div>
      ) : (
        <div
          className={cn(
            "flex min-w-0 gap-2",
            compact ? "flex-1 items-center" : "w-full items-start sm:flex-1",
          )}
        >
          {dragHandle}
          {clickableBody}
        </div>
      )}
      {(actions || !isClickable) && !useHeaderActions && !useFooterActions ? (
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
