import { useContext } from "react";
import { X } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import Button from "../../../components/Button/Button";
import type { TeamScheduleShadowAssignment } from "../../../api/authTypes";
import { shadowKindLabel } from "../teamsUtils";
import { ScheduleAssignmentContext } from "./ScheduleAssignmentContext";
import {
  MemberNameWithIndicator,
  useCurrentMemberId,
} from "../components/CurrentUserMemberIndicator";

type ScheduleShadowChipProps = {
  occurrenceId: string;
  cellKey: string;
  positionId: string;
  shadow: TeamScheduleShadowAssignment;
  memberName: string;
  memberId?: string;
  canEdit: boolean;
  className?: string;
};

/**
 * A shadow / reverse-shadow assignee chip with an inline remove control. Shared by
 * every schedule layout (grid, transpose, board) so removing a shadow behaves
 * identically everywhere: the "×" dispatches commitShadowAssignment("remove")
 * through the shared assignment context — the same path the undo stack uses.
 */
const ScheduleShadowChip = ({
  occurrenceId,
  cellKey,
  positionId,
  shadow,
  memberName,
  memberId,
  canEdit,
  className,
}: ScheduleShadowChipProps) => {
  const selfMemberId = useCurrentMemberId();
  const handlersRef = useContext(ScheduleAssignmentContext);
  const label = `${shadowKindLabel(shadow.kind)}: ${memberName}`;
  const accessibleLabel = `${label}${memberId && memberId === selfMemberId ? ", You" : ""}`;

  const handleRemove = () => {
    void handlersRef?.current?.commitShadowAssignment({
      serviceId: occurrenceId,
      cellKey,
      basePositionId: positionId,
      memberId: shadow.memberId,
      shadowKind: shadow.kind,
      action: "remove",
    });
  };

  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-lg border border-amber-300/35 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-50",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-1">
        <span className="shrink-0">{shadowKindLabel(shadow.kind)}:</span>
        <MemberNameWithIndicator
          name={memberName}
          memberId={memberId}
          className="min-w-0 flex-1"
          nameClassName="text-xs text-amber-50"
          indicatorClassName="bg-cyan-300/10 text-cyan-200"
        />
      </span>
      {canEdit ? (
        <Button
          type="button"
          variant="tertiary"
          svg={X}
          iconSize="sm"
          padding="p-0.5"
          data-schedule-shadow-remove
          aria-label={`Remove ${accessibleLabel}`}
          className="shrink-0 rounded text-amber-200/80 hover:bg-amber-400/20 hover:text-amber-50"
          onClick={handleRemove}
        />
      ) : null}
    </span>
  );
};

export default ScheduleShadowChip;
