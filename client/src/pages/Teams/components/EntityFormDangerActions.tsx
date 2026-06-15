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
  onDelete?: () => void;
  archiveLabel?: string;
  deleteLabel?: string;
  menuLabel?: string;
};

/** Archive and delete actions in the edit panel header menu. */
const EntityFormDangerActions = ({
  archived = false,
  canEdit = true,
  onArchive,
  onDelete,
  archiveLabel = "Archive",
  deleteLabel = "Delete",
  menuLabel = "More actions",
}: EntityFormDangerActionsProps) => {
  const menuItems = useMemo(() => {
    const items: MenuItemType[] = [];
    if (!canEdit) return items;
    if (!archived && onArchive) {
      items.push({ text: archiveLabel, onClick: onArchive });
    }
    if (onDelete) {
      items.push({ text: deleteLabel, variant: "destructive", onClick: onDelete });
    }
    return items;
  }, [archived, archiveLabel, canEdit, deleteLabel, onArchive, onDelete]);

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
