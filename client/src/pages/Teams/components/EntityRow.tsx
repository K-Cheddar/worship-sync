import { type CSSProperties, type ReactNode, type Ref, useMemo } from "react";
import { MoreVertical, Pencil } from "lucide-react";
import Button from "../../../components/Button/Button";
import Menu from "../../../components/Menu/Menu";
import type { MenuItemType } from "../../../types";
import { resolvePositionLucideIcon } from "../lucidePositionIcons";

type EntityRowProps = {
  title: string;
  subtitle?: string;
  /** Secondary detail shown below subtitle with reduced emphasis (e.g. member notes). */
  note?: string;
  icon?: string;
  archived?: boolean;
  onEdit: () => void;
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

  return (
    <div
      ref={rowRef}
      style={style}
      className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2">
        {dragHandle}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {IconComponent ? (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cyan-300/30 bg-cyan-400/10 text-cyan-100">
                <IconComponent className="h-4 w-4" />
              </span>
            ) : null}
            <p className="truncate font-semibold text-white">{title}</p>
            {archived ? (
              <span className="shrink-0 rounded border border-gray-600 px-1.5 py-0.5 text-xs text-gray-300">
                Archived
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="mt-1 text-sm leading-relaxed text-gray-300">{subtitle}</p>
          ) : null}
          {note ? (
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{note}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 self-start">
        {actions}
        {canEdit ? (
          <Button
            variant="tertiary"
            svg={Pencil}
            iconSize="sm"
            padding="px-2 py-1"
            aria-label={`Edit ${title}`}
            onClick={onEdit}
          >
            Edit
          </Button>
        ) : null}
        {menuItems.length > 0 ? (
          <Menu
            align="end"
            menuItems={menuItems}
            TriggeringButton={
              <Button
                variant="tertiary"
                svg={MoreVertical}
                padding="px-2 py-1"
                aria-label={`More actions for ${title}`}
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
};

export default EntityRow;
