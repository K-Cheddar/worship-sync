import type {
  PositionRequirement,
  TeamScheduleAdditionalPositionSlots,
  TeamScheduleOccurrence,
} from "../../../api/authTypes";
import type { PositionIcon } from "../../../components/icons/iconTypes";
import type { ScheduleExportColumn } from "./scheduleExport";
import { buildScheduleColumns } from "./scheduleRequirements";

export type PublicSchedulePosition = {
  positionId: string;
  name: string;
  groupId?: string;
  archivedAt?: string | null;
  icon?: PositionIcon;
};

/** Adapt the shared occurrence-aware schedule columns for the public export model. */
export const buildPublicScheduleColumns = ({
  occurrences,
  requirementsByOccurrence,
  additionalPositionSlots,
  positions,
}: {
  occurrences: Pick<TeamScheduleOccurrence, "occurrenceId">[];
  requirementsByOccurrence: Map<string, PositionRequirement[]>;
  additionalPositionSlots?: TeamScheduleAdditionalPositionSlots;
  positions: PublicSchedulePosition[];
}): ScheduleExportColumn[] =>
  buildScheduleColumns({
    occurrences,
    requirementsByOccurrence,
    additionalPositionSlots,
    positions,
    teamPositionIds: positions.map((position) => position.positionId),
  }).map(({ position, ...column }) => ({
    ...column,
    icon: position.icon,
  }));
