import { useMemo } from "react";
import { MoreVertical } from "lucide-react";
import Button from "../../../components/Button/Button";
import Menu from "../../../components/Menu/Menu";
import type { MenuItemType } from "../../../types";
import {
  teamsRowIconButtonClassName,
  teamsRowIconButtonPadding,
} from "../teamsStyles";

type EntityFormDangerActionsProps = {
  archived?: boolean;
  canEdit?: boolean;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  archiveLabel?: string;
  restoreLabel?: string;
  deleteLabel?: string;
  menuLabel?: string;
};

/** Archive and delete actions in the edit panel header menu. */
const EntityFormDangerActions = ({
  archived = false,
  canEdit = true,
  onArchive,
  onRestore,
  onDelete,
  archiveLabel = "Archive",
  restoreLabel = "Restore",
  deleteLabel = "Delete",
  menuLabel = "More actions",
}: EntityFormDangerActionsProps) => {
  const menuItems = useMemo(() => {
    const items: MenuItemType[] = [];
    if (!canEdit) return items;
    if (archived && onRestore) {
      items.push({ text: restoreLabel, onClick: onRestore });
    } else if (!archived && onArchive) {
      items.push({ text: archiveLabel, onClick: onArchive });
    }
    if (onDelete) {
      items.push({ text: deleteLabel, variant: "destructive", onClick: onDelete });
    }
    return items;
  }, [archived, archiveLabel, canEdit, deleteLabel, onArchive, onDelete, onRestore, restoreLabel]);

  if (menuItems.length === 0) return null;

  return (
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
          aria-label={menuLabel}
        />
      }
    />
  );
};

export default EntityFormDangerActions;
