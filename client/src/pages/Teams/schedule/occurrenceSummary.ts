import type {
  PositionRequirement,
  TeamRosterMember,
  TeamScheduleCellAssignment,
  TeamScheduleShadowKind,
} from "../../../api/authTypes";
import {
  getCellPrimaryMemberId,
  getCellShadowAssignments,
  scheduleMemberName,
  shadowKindLabel,
} from "../teamsUtils";
import {
  getRequiredCount,
  makeSlotKey,
  type ScheduleSlotColumn,
} from "./scheduleRequirements";

/** A single assigned person on a position, primary slot or shadow. */
export type OccurrenceSummaryMember = {
  memberId: string;
  name: string;
  kind: "primary" | TeamScheduleShadowKind;
};

export type OccurrenceSummaryPosition = {
  positionId: string;
  name: string;
  groupId?: string;
  requiredCount: number;
  /** Primary assignees first (in slot order), then shadows. */
  members: OccurrenceSummaryMember[];
};

/**
 * Positions clustered for display/export. Positions that share a `groupId`
 * (e.g. several camera roles) stay together; ungrouped positions each stand
 * alone. A blank line separates groups in the copied message.
 */
export type OccurrenceSummaryGroup = {
  key: string;
  positions: OccurrenceSummaryPosition[];
};

export const OCCURRENCE_EMPTY_SLOT_LABEL = "TBD";

/**
 * Collapse the per-slot schedule columns into per-position assignment summaries
 * for one occurrence, resolving member names and grouping by position group.
 * Only positions that this occurrence actually requires are included.
 */
export const buildOccurrenceSummaryGroups = ({
  columns,
  requirements,
  assignmentsRow,
  members,
  duplicateFirstNames,
}: {
  columns: ScheduleSlotColumn[];
  requirements: PositionRequirement[] | undefined;
  assignmentsRow: Record<string, TeamScheduleCellAssignment> | undefined;
  members: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
}): OccurrenceSummaryGroup[] => {
  const memberById = new Map(members.map((member) => [member.memberId, member]));
  const nameOf = (memberId: string) =>
    scheduleMemberName(memberById.get(memberId), duplicateFirstNames);

  const seen = new Set<string>();
  const positions: OccurrenceSummaryPosition[] = [];
  for (const column of columns) {
    if (seen.has(column.positionId)) continue;
    seen.add(column.positionId);
    const requiredCount = getRequiredCount(requirements, column.positionId);
    if (requiredCount <= 0) continue;

    const primaries: OccurrenceSummaryMember[] = [];
    const shadows: OccurrenceSummaryMember[] = [];
    for (let slot = 0; slot < requiredCount; slot += 1) {
      const cell = assignmentsRow?.[makeSlotKey(column.positionId, slot)];
      const primaryId = getCellPrimaryMemberId(cell);
      if (primaryId) {
        primaries.push({ memberId: primaryId, name: nameOf(primaryId), kind: "primary" });
      }
      getCellShadowAssignments(cell).forEach((shadow) => {
        shadows.push({ memberId: shadow.memberId, name: nameOf(shadow.memberId), kind: shadow.kind });
      });
    }

    positions.push({
      positionId: column.positionId,
      name: column.position.name,
      groupId: column.position.groupId,
      requiredCount,
      members: [...primaries, ...shadows],
    });
  }

  const groups: OccurrenceSummaryGroup[] = [];
  positions.forEach((position) => {
    const key = position.groupId ? `group:${position.groupId}` : `solo:${position.positionId}`;
    const last = groups[groups.length - 1];
    // Only merge into the previous block when both share a real group id.
    if (last && last.key === key && position.groupId) {
      last.positions.push(position);
    } else {
      groups.push({ key, positions: [position] });
    }
  });
  return groups;
};

/** "Kevin" for a primary, "Sam (shadow)" / "Sam (reverse shadow)" for a shadow. */
export const formatSummaryMemberToken = (member: OccurrenceSummaryMember) =>
  member.kind === "primary"
    ? member.name
    : `${member.name} (${shadowKindLabel(member.kind).toLowerCase()})`;

export const formatOccurrencePositionLine = (position: OccurrenceSummaryPosition) => {
  const tokens = position.members.map(formatSummaryMemberToken);
  return `${position.name}: ${tokens.length ? tokens.join(", ") : OCCURRENCE_EMPTY_SLOT_LABEL}`;
};

export const formatOccurrenceDateLabel = (startsAt: string) =>
  new Date(startsAt).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

/**
 * Render the WhatsApp-friendly schedule message: a title line, then one line
 * per position, with a blank line between position groups.
 */
export const formatOccurrenceMessage = ({
  startsAt,
  groups,
}: {
  startsAt: string;
  groups: OccurrenceSummaryGroup[];
}): string => {
  const lines: string[] = [`Schedule for ${formatOccurrenceDateLabel(startsAt)}`];
  groups.forEach((group) => {
    lines.push("");
    group.positions.forEach((position) => {
      lines.push(formatOccurrencePositionLine(position));
    });
  });
  return lines.join("\n");
};
