import type { TeamScheduleAssignments } from "../../../api/authTypes";
import type { ScheduleExportColumn } from "./scheduleExport";
import { makeSlotKey, parseSlotKey } from "./scheduleRequirements";

/**
 * Public (view-only) schedules don't have access to service position
 * requirements, so columns are derived from the assignments themselves: a
 * position gets as many slot columns as the highest slot anyone is actually
 * assigned to, in the team's position order. Every derived slot is treated as
 * "required" so an unfilled cell shows a dash rather than disappearing.
 */

export type PublicSchedulePosition = {
  positionId: string;
  name: string;
  groupId?: string;
  archivedAt?: string | null;
};

const cellHasAssignee = (cell: {
  primaryMemberId?: string;
  shadows?: { memberId: string }[];
}) => Boolean(cell?.primaryMemberId) || Boolean(cell?.shadows?.length);

export const buildPublicScheduleColumns = ({
  assignments,
  positions,
}: {
  assignments: TeamScheduleAssignments | undefined;
  positions: PublicSchedulePosition[];
}): {
  columns: ScheduleExportColumn[];
  slotCountByPosition: Map<string, number>;
} => {
  const maxSlotByPosition = new Map<string, number>();
  Object.values(assignments || {}).forEach((row) => {
    Object.entries(row || {}).forEach(([key, cell]) => {
      const parsed = parseSlotKey(key);
      if (!parsed || !cellHasAssignee(cell)) return;
      const previous = maxSlotByPosition.get(parsed.positionId);
      if (previous === undefined || parsed.slot > previous) {
        maxSlotByPosition.set(parsed.positionId, parsed.slot);
      }
    });
  });

  const columns: ScheduleExportColumn[] = [];
  const slotCountByPosition = new Map<string, number>();
  positions.forEach((position) => {
    const maxSlot = maxSlotByPosition.get(position.positionId);
    if (maxSlot === undefined) return; // no one assigned to this position anywhere
    const totalSlots = maxSlot + 1;
    slotCountByPosition.set(position.positionId, totalSlots);
    for (let slot = 0; slot < totalSlots; slot += 1) {
      columns.push({
        columnKey: makeSlotKey(position.positionId, slot),
        positionId: position.positionId,
        slot,
        label: totalSlots > 1 ? `${position.name} ${slot + 1}` : position.name,
      });
    }
  });
  return { columns, slotCountByPosition };
};

/**
 * Per-service slot counts, scoped to the positions each service actually uses.
 *
 * The global `slotCountByPosition` is the union across the whole schedule, so it
 * can't tell a "By date" card which positions belong to *this* service. Here a
 * position is active for a service only if someone is assigned to it in one of
 * that service's occurrences, with as many slots as the highest slot used. Other
 * services' positions resolve to 0 (inactive) and drop out of the card.
 *
 * Returns serviceId -> (positionId -> slot count).
 */
export const buildPublicServiceSlotCounts = ({
  assignments,
  serviceIdByOccurrence,
}: {
  assignments: TeamScheduleAssignments | undefined;
  serviceIdByOccurrence: Map<string, string>;
}): Map<string, Map<string, number>> => {
  const byService = new Map<string, Map<string, number>>();
  Object.entries(assignments || {}).forEach(([occurrenceId, row]) => {
    const serviceId = serviceIdByOccurrence.get(occurrenceId);
    if (!serviceId) return;
    Object.entries(row || {}).forEach(([key, cell]) => {
      const parsed = parseSlotKey(key);
      if (!parsed || !cellHasAssignee(cell)) return;
      let positionCounts = byService.get(serviceId);
      if (!positionCounts) {
        positionCounts = new Map<string, number>();
        byService.set(serviceId, positionCounts);
      }
      const totalSlots = parsed.slot + 1;
      const previous = positionCounts.get(parsed.positionId);
      if (previous === undefined || totalSlots > previous) {
        positionCounts.set(parsed.positionId, totalSlots);
      }
    });
  });
  return byService;
};
